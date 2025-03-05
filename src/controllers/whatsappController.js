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

    // Validar formato do webhook e extrair informações da mensagem
    if (!req.body || !req.body.entry || !Array.isArray(req.body.entry) || !req.body.entry.length) {
      console.log('[WhatsApp Controller] Formato de webhook inválido:', JSON.stringify(req.body).substring(0, 200));
      return;
    }

    const messageInfo = extractMessageInfo(req.body);
    
    if (!messageInfo) {
      console.log('[WhatsApp Controller] Nenhuma mensagem de texto encontrada no webhook');
      return;
    }
    
    const { from, text, timestamp } = messageInfo;
    console.log(`[WhatsApp Controller] Mensagem recebida de ${from}: ${text}`);

    // Usar o middleware de contexto de conversação através do objeto req
    // Salvar a mensagem do usuário no histórico
    await req.conversationContext.saveMessage('user', text);

    // Obter o histórico da conversa para este número
    const conversationHistory = await req.conversationContext.getHistory();

    // Processar a mensagem com GPT-4.5
    console.log('[WhatsApp Controller] Processando mensagem com GPT-4.5');
    console.log(`[WhatsApp Controller] Histórico para análise: ${conversationHistory.length} mensagens`);
    
    // Log das últimas 3 mensagens do histórico para diagnóstico
    if (conversationHistory.length > 0) {
      const recentMsgs = conversationHistory.slice(-3);
      recentMsgs.forEach((msg, i) => {
        console.log(`[WhatsApp Controller] Mensagem recente ${i + 1}: ${msg.role} - "${msg.content.substring(0, 50)}..."`);
      });
    }
    
    // Obter informações do paciente se disponível
    const { getPatientByPhone, savePatient, scheduleReminderMessage } = require('../services/patientService');
    const patientInfo = await getPatientByPhone(from);
    
    // Processar mensagem com GPT
    const gptResponse = await processMessageWithGPT(conversationHistory, patientInfo);

    // Adicionar a resposta do assistente ao histórico para análise posterior
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
                // Salvar ou atualizar informações do paciente
                const savedPatient = await savePatient({
                  name: appointmentDetails.patientName,
                  cpf: appointmentDetails.patientCPF,
                  phoneNumber: from
                });
                console.log(`[WhatsApp Controller] Paciente ${savedPatient.created ? 'criado' : 'atualizado'}: ${savedPatient.id}`);
                
                // Adicionar ID do paciente nos detalhes
                appointmentDetails.patientId = savedPatient.id;
                
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
                
                // Agendar mensagens de lembrete
                const appointmentDateTime = new Date(`${appointmentDetails.date}T${appointmentDetails.time}`);
                scheduleReminderMessage(from, appointmentDateTime, appointmentDetails.patientName);
              } catch (calendarError) {
                console.error(`[WhatsApp Controller] ERRO ao criar agendamento:`, calendarError);
                // Informar o usuário sobre o erro
                await sendTextMessage(from, `Desculpe, não foi possível agendar sua consulta: ${calendarError.message}. Por favor, tente novamente mais tarde.`);
              }
            } else {
              // Logging detalhado para entender o que está faltando
              console.log(`[WhatsApp Controller] Detalhes de agendamento incompletos ou inválidos:`);
              
              if (!appointmentDetails.patientName) {
                console.log(`[WhatsApp Controller] - Nome do paciente não fornecido`);
              }
              
              if (!appointmentDetails.patientCPF) {
                console.log(`[WhatsApp Controller] - CPF não fornecido`);
              } else if (appointmentDetails.validations && !appointmentDetails.validations.cpf.valid) {
                console.log(`[WhatsApp Controller] - CPF inválido: ${appointmentDetails.patientCPF} - ${appointmentDetails.validations.cpf.message}`);
              }
              
              if (!appointmentDetails.date) {
                console.log(`[WhatsApp Controller] - Data não fornecida`);
              } else if (appointmentDetails.validations && !appointmentDetails.validations.date.valid) {
                console.log(`[WhatsApp Controller] - Data inválida: ${appointmentDetails.date} - ${appointmentDetails.validations.date.message}`);
              }
              
              if (!appointmentDetails.time) {
                console.log(`[WhatsApp Controller] - Hora não fornecida`);
              } else if (appointmentDetails.validations && !appointmentDetails.validations.time.valid) {
                console.log(`[WhatsApp Controller] - Hora inválida: ${appointmentDetails.time} - ${appointmentDetails.validations.time.message}`);
              }
            }
            break;
            
          case 'cancelar':
            // Verificar se o CPF foi fornecido e é válido
            if (intent.entities && intent.entities.cpf) {
              // Validar CPF
              if (intent.cpfVerified || await verifyCPF(intent.entities.cpf, from)) {
                // Buscar agendamentos deste paciente pelo CPF
                const appointments = await getPatientAppointmentsByCPF(intent.entities.cpf);
                
                if (appointments && appointments.length > 0) {
                  console.log(`[WhatsApp Controller] Encontrados ${appointments.length} agendamentos para este CPF`);
                  
                  // Pegar o agendamento mais próximo
                  const appointment = appointments[0];
                  
                  try {
                    // Cancelar o agendamento no Google Calendar
                    await cancelAppointment(appointment.calendar_event_id);
                    console.log(`[WhatsApp Controller] Agendamento ${appointment.calendar_event_id} cancelado com sucesso`);
                    
                    // Configurar o resultado da ação para incorporar na resposta
                    actionResult = {
                      action: 'cancelar',
                      date: new Date(appointment.start_time).toLocaleDateString('pt-BR'),
                      time: new Date(appointment.start_time).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})
                    };
                  } catch (error) {
                    console.error(`[WhatsApp Controller] Erro ao cancelar agendamento:`, error);
                    await sendTextMessage(from, `Desculpe, não foi possível cancelar sua consulta. Por favor, tente novamente mais tarde ou entre em contato por telefone.`);
                  }
                } else {
                  console.log(`[WhatsApp Controller] Nenhum agendamento encontrado para o CPF ${intent.entities.cpf}`);
                  await sendTextMessage(from, `Não encontramos nenhum agendamento ativo para o CPF ${intent.entities.cpf}. Por favor, verifique se o CPF está correto ou entre em contato conosco por telefone.`);
                }
              } else {
                console.log(`[WhatsApp Controller] CPF inválido ou não corresponde ao paciente: ${intent.entities.cpf}`);
                await sendTextMessage(from, `O CPF informado parece ser inválido ou não corresponde aos nossos registros. Por favor, verifique e tente novamente.`);
              }
            } else {
              console.log(`[WhatsApp Controller] CPF não fornecido para cancelamento`);
            }
            break;
            
          case 'remarcar':
            // Verificar se o CPF foi fornecido e é válido e se temos novos detalhes
            if (intent.entities && intent.entities.cpf && intent.entities.data && intent.entities.hora) {
              // Validar CPF
              if (intent.cpfVerified || await verifyCPF(intent.entities.cpf, from)) {
                // Buscar agendamentos deste paciente pelo CPF
                const appointments = await getPatientAppointmentsByCPF(intent.entities.cpf);
                
                if (appointments && appointments.length > 0) {
                  console.log(`[WhatsApp Controller] Encontrados ${appointments.length} agendamentos para este CPF`);
                  
                  // Pegar o agendamento mais próximo
                  const appointment = appointments[0];
                  
                  try {
                    // Validar o novo horário
                    const startDateTime = new Date(`${intent.entities.data}T${intent.entities.hora}`);
                    const { validateAppointmentDateTime } = require('../services/patientService');
                    const validation = validateAppointmentDateTime(startDateTime);
                    
                    if (!validation.valid) {
                      console.log(`[WhatsApp Controller] Horário inválido para remarcação: ${validation.message}`);
                      await sendTextMessage(from, `Não foi possível remarcar para o horário solicitado: ${validation.message}. Por favor, escolha outro horário.`);
                      break;
                    }
                    
                    const endDateTime = new Date(startDateTime.getTime() + 30 * 60000); // 30 minutos
                    
                    const newDetails = {
                      startDateTime,
                      endDateTime
                    };
                    
                    // Remarcar o agendamento no Google Calendar
                    await rescheduleAppointment(appointment.calendar_event_id, newDetails);
                    console.log(`[WhatsApp Controller] Agendamento ${appointment.calendar_event_id} remarcado com sucesso`);
                    
                    // Configurar o resultado da ação para incorporar na resposta
                    actionResult = {
                      action: 'remarcar',
                      date: intent.entities.data,
                      time: intent.entities.hora
                    };
                    
                    // Obter nome do paciente para agendar lembretes
                    const patientData = await getPatientByPhone(from);
                    if (patientData && patientData.name) {
                      // Agendar mensagens de lembrete para a nova data
                      scheduleReminderMessage(from, startDateTime, patientData.name);
                    }
                  } catch (error) {
                    console.error(`[WhatsApp Controller] Erro ao remarcar agendamento:`, error);
                    await sendTextMessage(from, `Desculpe, não foi possível remarcar sua consulta. Por favor, tente novamente mais tarde ou entre em contato por telefone.`);
                  }
                } else {
                  console.log(`[WhatsApp Controller] Nenhum agendamento encontrado para o CPF ${intent.entities.cpf}`);
                  await sendTextMessage(from, `Não encontramos nenhum agendamento ativo para o CPF ${intent.entities.cpf}. Por favor, verifique se o CPF está correto ou entre em contato conosco por telefone.`);
                }
              } else {
                console.log(`[WhatsApp Controller] CPF inválido ou não corresponde ao paciente: ${intent.entities.cpf}`);
                await sendTextMessage(from, `O CPF informado parece ser inválido ou não corresponde aos nossos registros. Por favor, verifique e tente novamente.`);
              }
            } else {
              console.log(`[WhatsApp Controller] Informações incompletas para remarcação`);
              if (!intent.entities.cpf) console.log(`[WhatsApp Controller] - CPF não fornecido`);
              if (!intent.entities.data) console.log(`[WhatsApp Controller] - Data não fornecida`);
              if (!intent.entities.hora) console.log(`[WhatsApp Controller] - Hora não fornecida`);
            }
            break;
        }
      } catch (error) {
        console.error('[WhatsApp Controller] Erro ao processar ação de agendamento:', error);
        await sendTextMessage(from, `Desculpe, ocorreu um erro ao processar sua solicitação. Por favor, tente novamente mais tarde ou entre em contato por telefone.`);
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