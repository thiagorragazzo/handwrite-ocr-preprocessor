const { VERIFY_TOKEN, extractMessageInfo, sendTextMessage } = require('../config/whatsappConfig');
const { processMessageWithGPT, analyzeIntent, incorporateActionConfirmation } = require('../services/openaiService');
const { mapIntentToAppointmentDetails, verifyCPF, getPatientAppointmentsByCPF } = require('../services/patientService');
const { createAppointment, cancelAppointment, rescheduleAppointment } = require('../services/calendarService');

// Verificação do webhook do WhatsApp
const verifyWebhook = (req, res) => {
  // Verificar token
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    // Verificar se o token corresponde ao token de verificação
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook verificado com sucesso!');
      return res.status(200).send(challenge);
    } else {
      // Token inválido
      return res.sendStatus(403);
    }
  }

  return res.sendStatus(400);
};

// Receber mensagens do webhook do WhatsApp
const receiveMessage = async (req, res) => {
  try {
    // Responder imediatamente para o WhatsApp (200 OK)
    res.status(200).send('OK');

    // Extrair informações da mensagem do webhook
    const messageInfo = extractMessageInfo(req.body);
    
    if (!messageInfo) {
      console.log('Nenhuma mensagem de texto encontrada no webhook');
      return;
    }
    
    const { from, text, timestamp } = messageInfo;
    console.log(`Mensagem recebida de ${from}: ${text}`);

    // Usar o middleware de contexto de conversação através do objeto req
    // Salvar a mensagem do usuário no histórico
    await req.conversationContext.saveMessage('user', text);

    // Obter o histórico da conversa para este número
    const conversationHistory = await req.conversationContext.getHistory();

    // Processar a mensagem com GPT-4.5
    console.log('[WhatsApp] Processando mensagem com GPT-4.5');
    console.log(`[WhatsApp] Histórico para análise: ${conversationHistory.length} mensagens`);
    // Log das últimas 3 mensagens do histórico para diagnóstico
    if (conversationHistory.length > 0) {
      const recentMsgs = conversationHistory.slice(-3);
      recentMsgs.forEach((msg, i) => {
        console.log(`[WhatsApp] Mensagem recente ${i + 1}: ${msg.role} - "${msg.content.substring(0, 50)}..."`);
      });
    }
    const gptResponse = await processMessageWithGPT(conversationHistory);

    // Adicionar a última mensagem do assistente ao histórico para analisar a resposta completa
    // Isso permite que o GPT "veja" o fluxo real da conversa
    await req.conversationContext.saveMessage('assistant', gptResponse);

    // Obter o histórico atualizado para análise de intenção
    const updatedHistory = await req.conversationContext.getHistory();
    
    // Analisar a intenção do usuário com base na conversação atualizada
    const intent = await analyzeIntent(updatedHistory);
    
    // Variável para armazenar o resultado da ação (se houver)
    let actionResult = null;

    // Se a intenção for identificada como agendamento, cancelamento ou reagendamento
    if (intent && intent.type) {
      try {
        console.log(`[WhatsApp Controller] Intenção detectada: ${intent.type}`);
        console.log(`[WhatsApp Controller] Dados da intenção:`, JSON.stringify(intent, null, 2));
        
        switch (intent.type) {
          case 'agendar':
            // Extrair detalhes do agendamento usando os dados da intenção
            const appointmentDetails = mapIntentToAppointmentDetails(intent, from);
            console.log(`[WhatsApp Controller] Detalhes do agendamento mapeados:`, JSON.stringify(appointmentDetails, null, 2));
            
            if (appointmentDetails && appointmentDetails.isComplete) {
              console.log(`[WhatsApp Controller] Detalhes completos, prosseguindo com agendamento`);
              try {
                // Criar o agendamento no Google Calendar
                console.log(`[WhatsApp Controller] Chamando createAppointment...`);
                const calendarResult = await createAppointment(appointmentDetails);
                console.log(`[WhatsApp Controller] Agendamento criado com sucesso! ID: ${calendarResult.id}`);
                
                // Configurar o resultado da ação para incorporar na resposta
                actionResult = {
                  action: 'agendar',
                  date: appointmentDetails.date,
                  time: appointmentDetails.time,
                  eventId: calendarResult.id // Incluir ID do evento na resposta
                };
              } catch (calendarError) {
                console.error(`[WhatsApp Controller] ERRO ao criar agendamento no Google Calendar:`, calendarError);
                // Informar o usuário sobre o erro
                await sendTextMessage(from, `Desculpe, não foi possível agendar sua consulta: ${calendarError.message}. Por favor, tente novamente mais tarde.`);
              }
            } else {
              console.log(`[WhatsApp Controller] Detalhes de agendamento incompletos:`, 
                `Nome: ${appointmentDetails.patientName ? 'OK' : 'Faltando'}, ` +
                `CPF: ${appointmentDetails.patientCPF ? 'OK' : 'Faltando'}, ` +
                `Data: ${appointmentDetails.date ? 'OK' : 'Faltando'}, ` +
                `Hora: ${appointmentDetails.time ? 'OK' : 'Faltando'}`);
            }
            break;
            
          case 'cancelar':
            // Verificar se o CPF foi fornecido e é válido
            if (intent.entities && intent.entities.cpf && (intent.cpfVerified || await verifyCPF(intent.entities.cpf, from))) {
              // Buscar agendamentos deste paciente pelo CPF
              const appointments = await getPatientAppointmentsByCPF(intent.entities.cpf);
              
              if (appointments && appointments.length > 0) {
                // Pegar o agendamento mais próximo
                const appointment = appointments[0];
                
                // Cancelar o agendamento no Google Calendar
                await cancelAppointment(appointment.calendar_event_id);
                
                // Configurar o resultado da ação para incorporar na resposta
                actionResult = {
                  action: 'cancelar'
                };
              }
            }
            break;
            
          case 'remarcar':
            // Verificar se o CPF foi fornecido e é válido e se temos novos detalhes
            if (intent.entities && intent.entities.cpf && intent.entities.data && intent.entities.hora &&
                (intent.cpfVerified || await verifyCPF(intent.entities.cpf, from))) {
              
              // Buscar agendamentos deste paciente pelo CPF
              const appointments = await getPatientAppointmentsByCPF(intent.entities.cpf);
              
              if (appointments && appointments.length > 0) {
                // Pegar o agendamento mais próximo
                const appointment = appointments[0];
                
                // Criar novos detalhes para o agendamento
                const startDateTime = new Date(`${intent.entities.data}T${intent.entities.hora}`);
                const endDateTime = new Date(startDateTime.getTime() + 30 * 60000); // 30 minutos
                
                const newDetails = {
                  startDateTime,
                  endDateTime
                };
                
                // Remarcar o agendamento no Google Calendar
                await rescheduleAppointment(appointment.calendar_event_id, newDetails);
                
                // Configurar o resultado da ação para incorporar na resposta
                actionResult = {
                  action: 'remarcar',
                  date: intent.entities.data,
                  time: intent.entities.hora
                };
              }
            }
            break;
        }
      } catch (error) {
        console.error('Erro ao processar ação de agendamento:', error);
      }
    }

    // Incorporar confirmação da ação (se houver) na resposta do GPT
    const finalResponse = incorporateActionConfirmation(gptResponse, actionResult);

    // Como já salvamos a resposta do GPT no histórico antes de analisar a intenção,
    // precisamos atualizar a resposta somente se foi incorporado algo relevante
    if (finalResponse !== gptResponse) {
      // Atualizar a última mensagem do assistente no histórico
      // Apagar a última e adicionar a nova
      // Em um sistema de produção, seria melhor ter um método específico para atualizar
      await req.conversationContext.saveMessage('assistant', finalResponse);
    }

    // Enviar resposta combinada para o usuário via WhatsApp
    await sendTextMessage(from, finalResponse);

  } catch (error) {
    console.error('Erro ao processar mensagem do WhatsApp:', error);
    // Já enviamos 200 OK para o WhatsApp, então não precisamos responder novamente
  }
};

module.exports = {
  verifyWebhook,
  receiveMessage
};