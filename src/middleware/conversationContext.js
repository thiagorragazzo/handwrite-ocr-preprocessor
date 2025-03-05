const { db } = require('../config/db');

/**
 * Salva uma mensagem no histórico de conversas
 * @param {Object} message - Mensagem a ser salva
 * @param {string} message.phoneNumber - Número de telefone
 * @param {string} message.role - Papel na conversa (user ou assistant)
 * @param {string} message.content - Conteúdo da mensagem
 * @returns {Promise<void>}
 */
const saveMessage = async (message) => {
  const { phoneNumber, role, content } = message;
  
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO conversation_history (phone_number, role, content) VALUES (?, ?, ?)',
      [phoneNumber, role, content],
      function(err) {
        if (err) {
          console.error('Erro ao salvar mensagem no histórico:', err);
          reject(err);
          return;
        }
        resolve();
      }
    );
  });
};

/**
 * Obtém o histórico de conversas para um número de telefone
 * @param {string} phoneNumber - Número de telefone para buscar o histórico
 * @param {number} limit - Número máximo de mensagens a retornar (padrão: 20)
 * @returns {Promise<Array>} - Histórico de mensagens
 */
const getConversationHistory = async (phoneNumber, limit = 20) => {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT role, content, timestamp FROM conversation_history WHERE phone_number = ? ORDER BY timestamp ASC LIMIT ?',
      [phoneNumber, limit],
      (err, rows) => {
        if (err) {
          console.error('Erro ao buscar histórico de conversas:', err);
          reject(err);
          return;
        }
        
        // Formatar resultados para o formato esperado pela API da OpenAI
        // Removendo o campo timestamp que não é aceito pela OpenAI
        const formattedHistory = rows.map(row => ({
          role: row.role,
          content: row.content
        }));
        
        resolve(formattedHistory);
      }
    );
  });
};

/**
 * Limpa o histórico de conversas antigo
 * @param {number} days - Dias para manter (padrão: 30)
 * @returns {Promise<number>} - Número de registros removidos
 */
const cleanOldConversations = async (days = 30) => {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffTimestamp = cutoffDate.toISOString();
  
  return new Promise((resolve, reject) => {
    db.run(
      'DELETE FROM conversation_history WHERE timestamp < ?',
      [cutoffTimestamp],
      function(err) {
        if (err) {
          console.error('Erro ao limpar histórico de conversas antigas:', err);
          reject(err);
          return;
        }
        resolve(this.changes); // Número de registros afetados
      }
    );
  });
};

/**
 * Middleware para gerenciar contexto de conversação
 * 
 * Este middleware detecta o número de telefone da requisição e adiciona
 * métodos para gerenciar o histórico de conversação no objeto req.
 * Assim, os controllers podem acessar req.conversationContext.getHistory()
 * e req.conversationContext.saveMessage() sem precisar importar as funções diretamente.
 */
const conversationContextMiddleware = async (req, res, next) => {
  try {
    console.log('[Middleware] Inicializando middleware de contexto de conversação');
    console.log('[Middleware] Dados da requisição:', JSON.stringify(req.body).substring(0, 200) + '...');
    
    // Extrair número de telefone da requisição (da mensagem do WhatsApp)
    let phoneNumber = null;
    
    // Tentar extrair do webhook do WhatsApp (em req.body)
    if (req.body && req.body.entry && req.body.entry[0].changes && 
        req.body.entry[0].changes[0].value.messages &&
        req.body.entry[0].changes[0].value.messages[0]) {
      phoneNumber = req.body.entry[0].changes[0].value.messages[0].from;
      console.log(`[Middleware] Número de telefone extraído do webhook: ${phoneNumber}`);
    }
    
    // Alternativas para extrair o número de telefone
    if (!phoneNumber) {
      phoneNumber = req.body?.from || req.query?.from || req.params?.from;
      if (phoneNumber) {
        console.log(`[Middleware] Número de telefone extraído de alternativas: ${phoneNumber}`);
      }
    }
    
    if (!phoneNumber) {
      console.warn('[Middleware] ERRO: Não foi possível identificar o número de telefone na requisição');
      return next();
    }
    
    // Adicionar funções de contexto à requisição
    req.conversationContext = {
      getHistory: async (limit = 20) => {
        console.log(`[Middleware] Obtendo histórico para ${phoneNumber} (limite: ${limit})`);
        const history = await getConversationHistory(phoneNumber, limit);
        console.log(`[Middleware] Histórico obtido: ${history.length} mensagens`);
        return history;
      },
      saveMessage: async (role, content) => {
        console.log(`[Middleware] Salvando mensagem tipo '${role}' para ${phoneNumber}`);
        await saveMessage({ phoneNumber, role, content });
        console.log('[Middleware] Mensagem salva com sucesso');
        return true;
      },
      phoneNumber // Tornar o número de telefone disponível no contexto
    };
    
    console.log('[Middleware] Contexto de conversação configurado com sucesso');
    next();
  } catch (error) {
    console.error('[Middleware] Erro no middleware de contexto de conversação:', error);
    next(error);
  }
};

module.exports = {
  saveMessage,
  getConversationHistory,
  cleanOldConversations,
  conversationContextMiddleware
};