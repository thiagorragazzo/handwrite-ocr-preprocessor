require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { initializeDatabase, setupMaintenanceTasks } = require('./config/db');
const { initCalendarClient } = require('./services/calendarService');

// Configuração do sistema de logging
const fs = require('fs');
const logsDir = path.resolve(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Importando rotas
const whatsappRoutes = require('./routes/whatsappRoutes');
const appointmentRoutes = require('./routes/appointmentRoutes');

// Inicializando o app Express
const app = express();
const PORT = process.env.PORT || 8080;

// Configuração de rate limiter para prevenir ataques e abuso da API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // limite de 100 requisições por IP no intervalo
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Muitas requisições deste IP, por favor tente novamente mais tarde'
});

// Rate limiter específico para webhook (mais restritivo)
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 60, // 60 requisições por minuto (1 por segundo em média)
  standardHeaders: true, 
  legacyHeaders: false,
  message: 'Limite de requisições excedido para o webhook'
});

// Configuração do sistema de logs
const accessLogStream = fs.createWriteStream(
  path.join(logsDir, 'access.log'), 
  { flags: 'a' }
);

// Middleware
app.use(cors());
app.use(morgan('combined', { stream: accessLogStream })); // Para arquivo
app.use(morgan('dev')); // Para console
app.use(bodyParser.json({ 
  limit: '1mb',
  verify: (req, res, buf) => {
    // Salvar o body original para verificação de webhook
    req.rawBody = buf.toString();
  }
}));
app.use(bodyParser.urlencoded({ extended: true, limit: '1mb' }));

// Middleware de segurança adicional
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Aplicar rate limiters
app.use('/api', apiLimiter);
app.use('/webhook', webhookLimiter);

// Importar e configurar middleware de conversação
const { conversationContextMiddleware } = require('./middleware/conversationContext');

// Rotas
app.use('/webhook', conversationContextMiddleware, whatsappRoutes);
app.use('/appointments', apiLimiter, appointmentRoutes);

// Rota principal
app.get('/', (req, res) => {
  res.json({
    message: 'MedAgenda API - Sistema de agendamentos do Dr. Reinaldo Ragazzo',
    status: 'online',
    version: '1.0.0'
  });
});

// Rota para verificação de saúde (health check)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Middleware para tratamento de erros
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    message: err.message || 'Erro interno do servidor',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});

// Iniciar o sistema
async function startServer() {
  try {
    console.log('[Startup] Iniciando sistema MedAgenda...');
    
    // Inicializar banco de dados
    console.log('[Startup] Inicializando banco de dados...');
    await initializeDatabase();
    console.log('[Startup] Banco de dados inicializado com sucesso');
    
    // Configurar tarefas de manutenção
    console.log('[Startup] Configurando tarefas de manutenção...');
    setupMaintenanceTasks();
    
    // Inicializar cliente do Google Calendar
    console.log('[Startup] Inicializando cliente do Google Calendar...');
    await initCalendarClient();

    // Iniciar o servidor
    app.listen(PORT, () => {
      console.log(`[Startup] Servidor rodando na porta ${PORT}`);
      console.log(`[Startup] Ambiente: ${process.env.NODE_ENV || 'development'}`);
      console.log('[Startup] Sistema MedAgenda inicializado com sucesso!');
    });
    
    // Adicionar handler para graceful shutdown
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
    
  } catch (err) {
    console.error('[Startup] ERRO FATAL ao inicializar o sistema:', err);
    process.exit(1);
  }
}

// Função para shutdown gracioso do sistema
async function gracefulShutdown() {
  console.log('[Shutdown] Iniciando encerramento gracioso do sistema...');
  
  try {
    // Fechar banco de dados
    const { closeDatabase, backupDatabase } = require('./config/db');
    
    // Fazer backup final
    console.log('[Shutdown] Realizando backup final do banco de dados...');
    await backupDatabase();
    
    // Fechar conexão com banco de dados
    console.log('[Shutdown] Fechando conexão com banco de dados...');
    await closeDatabase();
    
    console.log('[Shutdown] Sistema encerrado com sucesso!');
    process.exit(0);
  } catch (err) {
    console.error('[Shutdown] Erro ao encerrar sistema:', err);
    process.exit(1);
  }
}

// Iniciar o servidor
startServer();