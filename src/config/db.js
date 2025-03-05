const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

// Configuração do banco de dados
const dbPath = process.env.DB_PATH || path.resolve(__dirname, '../../data/database.sqlite');

// Garantir que o diretório para o BD existe
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Instância do banco de dados
let db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Erro ao conectar ao banco de dados SQLite:', err.message);
    return;
  }
  console.log('Conectado ao banco de dados SQLite');
});

// Função para inicializar o banco de dados
const initializeDatabase = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Tabela de pacientes
      db.run(`CREATE TABLE IF NOT EXISTS patients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        cpf TEXT UNIQUE NOT NULL,
        phone_number TEXT NOT NULL,
        email TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`, (err) => {
        if (err) {
          reject(err);
          return;
        }
      });

      // Tabela de agendamentos
      db.run(`CREATE TABLE IF NOT EXISTS appointments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id INTEGER NOT NULL,
        calendar_event_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP NOT NULL,
        status TEXT DEFAULT 'scheduled',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients (id)
      )`, (err) => {
        if (err) {
          reject(err);
          return;
        }
      });

      // Tabela para armazenar o histórico de conversas
      db.run(`CREATE TABLE IF NOT EXISTS conversation_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone_number TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`, (err) => {
        if (err) {
          reject(err);
          return;
        }
      });
      
      // Criar índices para melhorar a performance das consultas frequentes
      db.run(`CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone_number)`, (err) => {
        if (err) console.error('Erro ao criar índice para telefone:', err);
      });
      
      db.run(`CREATE INDEX IF NOT EXISTS idx_patients_cpf ON patients(cpf)`, (err) => {
        if (err) console.error('Erro ao criar índice para CPF:', err);
      });
      
      db.run(`CREATE INDEX IF NOT EXISTS idx_appointments_patient_id ON appointments(patient_id)`, (err) => {
        if (err) console.error('Erro ao criar índice para patient_id:', err);
      });
      
      db.run(`CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status)`, (err) => {
        if (err) console.error('Erro ao criar índice para status:', err);
      });
      
      db.run(`CREATE INDEX IF NOT EXISTS idx_appointments_start_time ON appointments(start_time)`, (err) => {
        if (err) console.error('Erro ao criar índice para start_time:', err);
      });
      
      db.run(`CREATE INDEX IF NOT EXISTS idx_conversation_phone ON conversation_history(phone_number)`, (err) => {
        if (err) console.error('Erro ao criar índice para conversation phone:', err);
      });
      
      db.run(`CREATE INDEX IF NOT EXISTS idx_conversation_timestamp ON conversation_history(timestamp)`, (err) => {
        if (err) console.error('Erro ao criar índice para conversation timestamp:', err);
      });

      resolve();
    });
  });
};

// Função para realizar backup do banco de dados
const backupDatabase = () => {
  const backupDir = path.resolve(__dirname, '../../backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  const date = new Date().toISOString().replace(/:/g, '-');
  const backupPath = path.join(backupDir, `database_backup_${date}.sqlite`);
  
  return new Promise((resolve, reject) => {
    console.log(`[Database] Iniciando backup para: ${backupPath}`);
    
    const reader = fs.createReadStream(dbPath);
    const writer = fs.createWriteStream(backupPath);
    
    reader.on('error', err => {
      console.error('[Database] Erro na leitura para backup:', err);
      reject(err);
    });
    
    writer.on('error', err => {
      console.error('[Database] Erro na escrita do backup:', err);
      reject(err);
    });
    
    writer.on('finish', () => {
      console.log(`[Database] Backup concluído: ${backupPath}`);
      resolve(backupPath);
    });
    
    reader.pipe(writer);
  });
};

// Função para fechar a conexão com o banco de dados
const closeDatabase = () => {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) {
        console.error('Erro ao fechar o banco de dados:', err.message);
        reject(err);
        return;
      }
      console.log('Conexão com o banco de dados fechada');
      resolve();
    });
  });
};

// Configurar limpeza automática de conversas antigas (a cada 30 dias)
const cleanOldConversations = () => {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 30);
  const cutoffTimestamp = cutoffDate.toISOString();
  
  return new Promise((resolve, reject) => {
    db.run(
      'DELETE FROM conversation_history WHERE timestamp < ?',
      [cutoffTimestamp],
      function(err) {
        if (err) {
          console.error('[Database] Erro ao limpar histórico de conversas antigas:', err);
          reject(err);
          return;
        }
        
        if (this.changes > 0) {
          console.log(`[Database] Limpeza automática: ${this.changes} mensagens antigas removidas`);
        }
        
        resolve(this.changes);
      }
    );
  });
};

// Configura tarefa de limpeza e backup periódicos
const setupMaintenanceTasks = () => {
  // Backup diário (24 horas)
  setInterval(() => {
    backupDatabase()
      .catch(err => console.error('[Database] Erro na tarefa automática de backup:', err));
  }, 24 * 60 * 60 * 1000);
  
  // Limpeza semanal (7 dias)
  setInterval(() => {
    cleanOldConversations()
      .catch(err => console.error('[Database] Erro na tarefa automática de limpeza:', err));
  }, 7 * 24 * 60 * 60 * 1000);
  
  console.log('[Database] Tarefas de manutenção periódicas configuradas');
};

// Exportando o banco de dados e funções de utilidade
module.exports = {
  db,
  initializeDatabase,
  closeDatabase,
  backupDatabase,
  cleanOldConversations,
  setupMaintenanceTasks
};