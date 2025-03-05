const { openaiClient, DEFAULT_MODEL_CONFIG, SYSTEM_PROMPT, OPENAI_API_URL } = require('../config/openaiConfig');
const { validateCPF } = require('./patientService');

/**
 * Processa mensagens do usuário com o GPT-4O
 * @param {Array} conversationHistory - Histórico de mensagens da conversa
 * @returns {Promise<string>} - Resposta gerada pelo GPT-4O
 */
const processMessageWithGPT = async (conversationHistory) => {
  try {
    console.log('[OpenAI] Iniciando processamento de mensagem');
    
    // Formatar as mensagens para o formato esperado pela API da OpenAI
    const messages = [
      // Primeiro, adicionar o prompt do sistema como role "system" (não "developer")
      { role: 'system', content: SYSTEM_PROMPT }
    ];

    // Adicionar histórico de mensagens (limitando a últimas 10 para evitar contexto muito grande)
    const recentHistory = conversationHistory.slice(-10);
    recentHistory.forEach(msg => {
      // Garantir que o role seja um dos valores aceitos pela API: 'system', 'user' ou 'assistant'
      let role = msg.role;
      if (role !== 'system' && role !== 'user' && role !== 'assistant') {
        role = 'user'; // Fallback seguro
      }
      
      messages.push({
        role: role,
        content: msg.content
      });
    });

    console.log(`[OpenAI] Preparadas ${messages.length} mensagens para envio ao GPT-4.5`);
    
    // Configuração para a requisição - removendo parâmetros inválidos
    const requestConfig = {
      model: DEFAULT_MODEL_CONFIG.model,
      temperature: DEFAULT_MODEL_CONFIG.temperature,
      top_p: DEFAULT_MODEL_CONFIG.top_p,
      n: DEFAULT_MODEL_CONFIG.n,
      messages
    };

    // Fazer a requisição para a API da OpenAI
    console.log('[OpenAI] Enviando requisição para GPT-4.5-preview...');
    const response = await openaiClient.post('/chat/completions', requestConfig);
    console.log('[OpenAI] Resposta recebida do GPT-4.5-preview');

    // Extrair o texto da resposta
    const assistantResponse = response.data.choices[0].message.content;
    console.log(`[OpenAI] Conteúdo da resposta: "${assistantResponse.substring(0, 50)}..."`);
    
    // Verificar se a resposta é muito curta ou genérica
    if (assistantResponse.length < 20) {
      console.log('[OpenAI] ALERTA: Resposta muito curta detectada, adicionando contexto');
      return assistantResponse + "\n\nPosso ajudar com algo mais sobre seu agendamento com o Dr. Reinaldo Ragazzo?";
    }
    
    // Detectar respostas genéricas comuns e adicionar personalização
    const genericResponses = [
      "Olá! Como posso ajudar você hoje?",
      "Como posso ajudar você hoje?",
      "Em que posso ajudar você hoje?",
      "Olá! Seja bem-vindo",
      "Seja bem-vindo",
      "Posso ajudar"
    ];
    
    // Se a resposta for genérica, adicione contexto específico
    if (genericResponses.some(generic => assistantResponse.includes(generic))) {
      console.log('[OpenAI] ALERTA: Resposta genérica detectada, personalizando');
      return "Olá! Sou Ana, secretária do consultório do Dr. Reinaldo Ragazzo. Posso ajudar você a agendar, confirmar, remarcar ou cancelar uma consulta. Em que posso ajudar hoje? 😊";
    }
    
    return assistantResponse;
  } catch (error) {
    console.error('Erro ao processar mensagem com GPT-4.5:', error.response?.data || error.message);
    console.error('Detalhes completos do erro:', error);
    
    // Retornar uma mensagem de erro genérica em caso de falha
    return 'Desculpe, estou com dificuldades para processar sua solicitação no momento. Por favor, tente novamente mais tarde.';
  }
};

/**
 * Analisa a intenção do usuário a partir do histórico de conversação
 * @param {Array} conversationHistory - Histórico de mensagens
 * @returns {Promise<Object|null>} - Objeto contendo intenção e entidades extraídas
 */
const analyzeIntent = async (conversationHistory) => {
  try {
    console.log('[OpenAI] Analisando intenção do usuário');
    
    // Extrair as últimas mensagens para análise
    const recentMessages = conversationHistory.slice(-5);
    
    // Juntar todas as mensagens para análise de contexto
    const fullText = recentMessages
      .map(msg => `${msg.role === 'user' ? 'Usuário' : 'Assistente'}: ${msg.content}`)
      .join('\n');
    
    console.log(`[OpenAI] Analisando texto: "${fullText.substring(0, 100)}..."`);
    
    const messages = [
      {
        role: 'system',
        content: `Você é um analisador de intenções para um sistema de agendamento médico.
          Identifique a intenção principal da conversa do usuário, classificando como uma das seguintes:
          - agendar: quando o usuário deseja marcar uma nova consulta
          - cancelar: quando o usuário deseja cancelar uma consulta existente
          - remarcar: quando o usuário deseja alterar a data/hora de uma consulta existente
          - informacao: quando o usuário está apenas solicitando informações
          
          Além disso, extraia quaisquer entidades relevantes mencionadas:
          - cpf: o número de CPF mencionado (extraia só os dígitos)
          - data: a data mencionada para consulta (formato YYYY-MM-DD)
          - hora: o horário mencionado (formato HH:MM)
          - nome: o nome completo do paciente
          - telefone: número de telefone mencionado
          
          ATENÇÃO: Responda APENAS com um objeto JSON puro, sem formatação markdown ou explicações. Não use crase (`) ou blocos de código. Apenas o JSON limpo.
          Formato esperado:
          {"type": "intenção identificada", "confidence": número, "entities": {"cpf": "12345678901", "data": "2025-03-15", "hora": "14:30", "nome": "Nome Completo", "telefone": "11999998888"}}`
      },
      {
        role: 'user',
        content: fullText
      }
    ];

    console.log('[OpenAI] Enviando requisição para análise de intenção...');
    const response = await openaiClient.post('/chat/completions', {
      model: DEFAULT_MODEL_CONFIG.model,
      temperature: 0.3, // Reduzindo a temperatura para obter respostas mais determinísticas
      top_p: 0.5,      // Reduzindo top_p para respostas mais focadas no formato solicitado
      n: 1,
      messages
    });
    console.log('[OpenAI] Resposta de análise recebida');

    // Extrair resposta e converter para objeto JSON
    let content = response.data.choices[0].message.content;
    console.log(`[OpenAI] Conteúdo da análise: ${content.substring(0, 100)}...`);
    
    try {
      // Limpeza de possíveis formatações markdown ou textos extras
      if (content.includes('```json')) {
        content = content.split('```json')[1].split('```')[0].trim();
      } else if (content.includes('```')) {
        content = content.split('```')[1].split('```')[0].trim();
      }
      
      // Eliminar possíveis linhas iniciais não-JSON
      if (content.trim().charAt(0) !== '{') {
        const jsonStart = content.indexOf('{');
        if (jsonStart !== -1) {
          content = content.substring(jsonStart);
        }
      }
      
      // Eliminar possíveis linhas finais não-JSON
      if (content.trim().charAt(content.trim().length - 1) !== '}') {
        const jsonEnd = content.lastIndexOf('}');
        if (jsonEnd !== -1) {
          content = content.substring(0, jsonEnd + 1);
        }
      }
      
      const result = JSON.parse(content);
      console.log(`[OpenAI] Intenção detectada: ${result.type} (confiança: ${result.confidence})`);
      
      // Validar CPF se estiver presente
      if (result.entities && result.entities.cpf) {
        result.cpfVerified = validateCPF(result.entities.cpf);
        console.log(`[OpenAI] CPF detectado: ${result.entities.cpf} (válido: ${result.cpfVerified})`);
      }
      
      return result;
    } catch (parseError) {
      console.error('[OpenAI] Erro ao analisar resposta JSON:', parseError);
      console.log('[OpenAI] Resposta não-JSON recebida:', content);
      
      // Fallback: Usar regex para detectar intenção
      console.log('[OpenAI] Usando fallback de regex para detecção de intenção');
      return fallbackIntentDetection(fullText);
    }
  } catch (error) {
    console.error('[OpenAI] Erro ao analisar intenção com GPT-4.5:', error.response?.data || error.message);
    
    // Em caso de erro na API, usar o fallback de regex
    console.log('[OpenAI] Usando fallback de regex devido a erro na API');
    return fallbackIntentDetection(conversationHistory);
  }
};

/**
 * Método de fallback para detectar intenção usando regex quando GPT falha
 * @param {string|Array} input - Texto ou histórico de conversa
 * @returns {Object} - Objeto contendo intenção e entidades detectadas
 */
const fallbackIntentDetection = (input) => {
  try {
    let fullText = '';
    
    // Se input for array (histórico de conversa), extrair texto
    if (Array.isArray(input)) {
      const recentMessages = input.slice(-5);
      fullText = recentMessages
        .map(msg => msg.content)
        .join('\n');
    } else {
      fullText = input;
    }
    
    // Palavras-chave para cada tipo de intenção
    const keywords = {
      agendar: ['agendar', 'marcar', 'consulta', 'disponibilidade', 'horário', 'vaga'],
      cancelar: ['cancelar', 'desmarcar', 'remover', 'anular'],
      remarcar: ['remarcar', 'reagendar', 'mudar', 'alterar', 'trocar']
    };
    
    // Verificar se há menção de CPF
    let cpf = null;
    const cpfPattern = /\b(\d{3}[\.\s]?\d{3}[\.\s]?\d{3}[-\.\s]?\d{2})\b/;
    const cpfMatch = fullText.match(cpfPattern);
    if (cpfMatch) {
      cpf = cpfMatch[1].replace(/[^\d]/g, '');
    }
    
    // Verificar intenção com base em palavras-chave
    let detectedIntent = 'informacao'; // Padrão
    let highestScore = 0;
    
    for (const [intent, intentKeywords] of Object.entries(keywords)) {
      let score = 0;
      
      intentKeywords.forEach(keyword => {
        const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
        const matches = fullText.match(regex) || [];
        score += matches.length;
      });
      
      if (score > highestScore) {
        highestScore = score;
        detectedIntent = intent;
      }
    }
    
    // Extrair outras entidades usando regex
    const entities = {};
    
    // Adicionar CPF se encontrado
    if (cpf) {
      entities.cpf = cpf;
    }
    
    // Tentar extrair data (DD/MM/YYYY ou DD-MM-YYYY)
    const datePattern = /(\d{1,2})[-\/\s](\d{1,2})(?:[-\/\s](\d{2,4}))?/;
    const dateMatch = fullText.match(datePattern);
    if (dateMatch) {
      const day = dateMatch[1].padStart(2, '0');
      const month = dateMatch[2].padStart(2, '0');
      const year = dateMatch[3] ? (dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3]) : new Date().getFullYear();
      entities.data = `${year}-${month}-${day}`;
    }
    
    // Tentar extrair horário (HH:MM ou HH h)
    const timePattern = /(\d{1,2})(?::(\d{2}))?(?:\s*(?:h|horas))?/;
    const timeMatch = fullText.match(timePattern);
    if (timeMatch) {
      const hour = timeMatch[1].padStart(2, '0');
      const minute = timeMatch[2] ? timeMatch[2] : '00';
      entities.hora = `${hour}:${minute}`;
    }
    
    return {
      type: detectedIntent,
      confidence: highestScore > 0 ? 0.6 : 0.3,
      entities,
      cpfVerified: cpf ? validateCPF(cpf) : false
    };
  } catch (error) {
    console.error('Erro no fallback de detecção de intenção:', error);
    return { 
      type: 'desconhecido', 
      confidence: 0.1, 
      entities: {} 
    };
  }
};

/**
 * Processa mensagem para incorporar confirmação de ação se necessário
 * @param {string} gptResponse - Resposta original do GPT
 * @param {Object} actionResult - Resultado da ação de agendamento 
 * @returns {string} - Resposta final combinada
 */
const incorporateActionConfirmation = (gptResponse, actionResult) => {
  if (!actionResult) return gptResponse;
  
  console.log(`[OpenAI Service] Incorporando confirmação de ação:`, JSON.stringify(actionResult, null, 2));
  
  // Criar um footer com a confirmação da ação
  let actionConfirmation = '';
  
  switch (actionResult.action) {
    case 'agendar':
      actionConfirmation = `\n\n✅ Consulta agendada com sucesso para ${actionResult.date} às ${actionResult.time}.`;
      if (actionResult.eventId) {
        actionConfirmation += `\nID do agendamento: ${actionResult.eventId}`;
      }
      break;
    case 'cancelar':
      actionConfirmation = '\n\n✅ Sua consulta foi cancelada com sucesso.';
      break;
    case 'remarcar':
      actionConfirmation = `\n\n✅ Sua consulta foi remarcada com sucesso para ${actionResult.date} às ${actionResult.time}.`;
      break;
    default:
      return gptResponse;
  }
  
  console.log(`[OpenAI Service] Mensagem de confirmação: "${actionConfirmation}"`);
  return gptResponse + actionConfirmation;
};

module.exports = {
  processMessageWithGPT,
  analyzeIntent,
  incorporateActionConfirmation
};