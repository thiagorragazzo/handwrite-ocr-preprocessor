const { db } = require('../config/db');
const crypto = require('crypto');

// Chave de criptografia - Em produção, use variáveis de ambiente!
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'chave-secreta-de-32-caracteres-aqui';
const IV_LENGTH = 16; // Para AES-256

/**
 * Criptografa dados sensíveis
 * @param {string} text - Texto para criptografar
 * @returns {string} - Texto criptografado no formato 'iv:encrypted'
 */
const encrypt = (text) => {
  if (!text) return null;
  
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  } catch (error) {
    console.error('[Encryption] Erro ao criptografar dados:', error.message);
    return null;
  }
};

/**
 * Descriptografa dados sensíveis
 * @param {string} text - Texto criptografado no formato 'iv:encrypted'
 * @returns {string} - Texto descriptografado
 */
const decrypt = (text) => {
  if (!text) return null;
  
  try {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (error) {
    console.error('[Encryption] Erro ao descriptografar dados:', error.message);
    return null;
  }
};

/**
 * Valida um número de CPF
 * @param {string} cpf - CPF para validação (pode conter pontuação)
 * @returns {boolean} - Verdadeiro se o CPF for válido
 */
const validateCPF = (cpf) => {
  // Remover caracteres não numéricos
  cpf = cpf.toString().replace(/[^\d]/g, '');

  // Verificar se tem 11 dígitos
  if (cpf.length !== 11) {
    return false;
  }

  // Verificar se todos os dígitos são iguais
  if (/^(\d)\1+$/.test(cpf)) {
    return false;
  }

  // Validação do primeiro dígito verificador
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cpf.charAt(i)) * (10 - i);
  }
  let remainder = sum % 11;
  let digit1 = remainder < 2 ? 0 : 11 - remainder;

  if (parseInt(cpf.charAt(9)) !== digit1) {
    return false;
  }

  // Validação do segundo dígito verificador
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(cpf.charAt(i)) * (11 - i);
  }
  remainder = sum % 11;
  let digit2 = remainder < 2 ? 0 : 11 - remainder;

  if (parseInt(cpf.charAt(10)) !== digit2) {
    return false;
  }

  return true;
};

/**
 * Verifica se um CPF corresponde a um paciente
 * @param {string} cpf - CPF para verificação
 * @param {string} phoneNumber - Número de telefone
 * @returns {Promise<boolean>} - Verdadeiro se o CPF corresponder ao paciente
 */
const verifyCPF = async (cpf, phoneNumber) => {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT cpf FROM patients WHERE phone_number = ?',
      [phoneNumber],
      (err, row) => {
        if (err) {
          console.error('Erro ao verificar CPF do paciente:', err);
          reject(err);
          return;
        }
        
        if (!row) {
          // Paciente não encontrado com este número
          resolve(false);
          return;
        }
        
        // Descriptografar o CPF armazenado se estiver criptografado
        // Verificamos se parece estar no formato IV:encrypted
        let storedCPF = row.cpf;
        if (storedCPF && storedCPF.includes(':')) {
          try {
            storedCPF = decrypt(storedCPF);
          } catch (e) {
            console.warn('Erro ao descriptografar CPF:', e.message);
            // Continuar com o valor original se falhar
          }
        }
        
        // Comparar o CPF fornecido com o armazenado
        const isMatch = storedCPF === cpf;
        resolve(isMatch);
      }
    );
  });
};

/**
 * Valida se o horário está dentro do horário de atendimento
 * @param {Date} dateTime - Data e hora para validar
 * @returns {Object} - Objeto com resultado da validação
 */
const validateAppointmentDateTime = (dateTime) => {
  const dayOfWeek = dateTime.getDay(); // 0=domingo, 1=segunda, ..., 6=sábado
  const hour = dateTime.getHours();
  const minute = dateTime.getMinutes();
  
  // Verificar se é domingo (não há atendimento)
  if (dayOfWeek === 0) {
    return { valid: false, message: 'Não atendemos aos domingos' };
  }
  
  // Verificar se é sábado (atendimento até 12h)
  if (dayOfWeek === 6) {
    if (hour >= 12) {
      return { valid: false, message: 'Aos sábados atendemos apenas até 12h' };
    }
    if (hour < 8) {
      return { valid: false, message: 'Aos sábados atendemos a partir das 8h' };
    }
  }
  
  // Verificar dias de semana (segunda a sexta)
  if (dayOfWeek >= 1 && dayOfWeek <= 5) {
    if (hour < 8) {
      return { valid: false, message: 'Atendemos a partir das 8h' };
    }
    if (hour >= 18) {
      return { valid: false, message: 'Atendemos até as 18h' };
    }
  }
  
  // Verificar se o minuto é múltiplo de 30 (consultas de meia hora)
  if (minute !== 0 && minute !== 30) {
    return { valid: false, message: 'Os horários de consulta são de 30 em 30 minutos (exemplos: 08:00, 08:30, 09:00...)' };
  }
  
  return { valid: true };
};

/**
 * Converte os detalhes de intenção retornados pelo GPT em dados de agendamento
 * @param {Object} intentData - Dados de intenção extraídos
 * @param {string} phoneNumber - Número de telefone (do WhatsApp)
 * @returns {Object} - Detalhes formatados para agendamento
 */
const mapIntentToAppointmentDetails = (intentData, phoneNumber) => {
  console.log(`[Patient Service] Mapeando detalhes de intenção para agendamento`);
  
  try {
    if (!intentData || !intentData.entities) {
      console.log(`[Patient Service] Dados de intenção não contêm entidades`);
      return { isComplete: false };
    }
    
    const { entities } = intentData;
    console.log(`[Patient Service] Entidades detectadas:`, JSON.stringify(entities, null, 2));
    
    // Extrair dados relevantes
    const patientName = entities.nome;
    const patientCPF = entities.cpf;
    const patientPhone = entities.telefone || phoneNumber; // Usar telefone do WhatsApp se não for fornecido explicitamente
    let appointmentDate = entities.data;
    let appointmentTime = entities.hora;
    
    // Formatação e validação de dados
    // 1. Validar CPF
    const isCPFValid = patientCPF ? validateCPF(patientCPF) : false;
    
    // 2. Formatar data
    if (appointmentDate && !appointmentDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      // Tentar converter de outros formatos comuns (DD/MM/YYYY ou DD-MM-YYYY)
      const parts = appointmentDate.split(/[-\/]/);
      if (parts.length === 3) {
        // Verificar se o primeiro número parece um dia (1-31)
        if (parseInt(parts[0]) >= 1 && parseInt(parts[0]) <= 31) {
          const day = parts[0].padStart(2, '0');
          const month = parts[1].padStart(2, '0');
          const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
          appointmentDate = `${year}-${month}-${day}`;
        }
      }
    }
    
    // Verificar se a data está no futuro
    let isDateValid = false;
    let dateValidationMessage = '';
    if (appointmentDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const requestedDate = new Date(appointmentDate);
      requestedDate.setHours(0, 0, 0, 0);
      
      isDateValid = requestedDate >= today;
      if (!isDateValid) {
        dateValidationMessage = 'A data selecionada está no passado. Por favor, escolha uma data futura.';
      }
    }
    
    // 3. Formatar hora
    if (appointmentTime) {
      // Garantir formato HH:MM
      appointmentTime = appointmentTime.replace(/[^\d:]/g, '');
      if (!appointmentTime.includes(':')) {
        // Se for apenas números, assumir que são horas
        appointmentTime = `${appointmentTime.padStart(2, '0')}:00`;
      } else if (appointmentTime.split(':').length === 2) {
        const [hours, minutes] = appointmentTime.split(':');
        appointmentTime = `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
      }
    }
    
    // 4. Validar hora de atendimento
    let isTimeValid = false;
    let timeValidationMessage = '';
    if (appointmentDate && appointmentTime) {
      const [hours, minutes] = appointmentTime.split(':');
      const dateTime = new Date(appointmentDate);
      dateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
      
      const validation = validateAppointmentDateTime(dateTime);
      isTimeValid = validation.valid;
      timeValidationMessage = validation.valid ? '' : validation.message;
    }
    
    // Verificar se temos todos os dados necessários e válidos
    const isComplete = patientName && 
                      patientCPF && 
                      isCPFValid && 
                      appointmentDate && 
                      isDateValid && 
                      appointmentTime && 
                      isTimeValid;
    
    const details = {
      patientName,
      patientCPF,
      patientPhone,
      date: appointmentDate,
      time: appointmentTime,
      isComplete,
      validations: {
        cpf: { valid: isCPFValid, message: isCPFValid ? '' : 'CPF inválido' },
        date: { valid: isDateValid, message: dateValidationMessage },
        time: { valid: isTimeValid, message: timeValidationMessage }
      }
    };
    
    console.log(`[Patient Service] Detalhes de agendamento mapeados:`, JSON.stringify(details, null, 2));
    
    if (!isComplete) {
      console.log(`[Patient Service] ATENÇÃO: Detalhes incompletos para agendamento.`);
      if (!patientName) console.log(`[Patient Service] Nome do paciente não encontrado.`);
      if (!patientCPF) console.log(`[Patient Service] CPF não encontrado.`);
      else if (!isCPFValid) console.log(`[Patient Service] CPF inválido: ${patientCPF}`);
      if (!appointmentDate) console.log(`[Patient Service] Data não encontrada.`);
      else if (!isDateValid) console.log(`[Patient Service] Data inválida: ${appointmentDate} - ${dateValidationMessage}`);
      if (!appointmentTime) console.log(`[Patient Service] Hora não encontrada.`);
      else if (!isTimeValid) console.log(`[Patient Service] Hora inválida: ${appointmentTime} - ${timeValidationMessage}`);
    }
    
    return details;
  } catch (error) {
    console.error('[Patient Service] Erro ao mapear intenção para detalhes de agendamento:', error);
    return { isComplete: false };
  }
};

/**
 * Obtém informações do paciente pelo número de telefone
 * @param {string} phoneNumber - Número de telefone
 * @returns {Promise<Object|null>} - Dados do paciente ou null
 */
const getPatientByPhone = async (phoneNumber) => {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT p.*, 
      (SELECT MAX(a.start_time) FROM appointments a WHERE a.patient_id = p.id AND a.status = 'completed') AS last_appointment,
      (SELECT COUNT(*) FROM appointments a WHERE a.patient_id = p.id) AS total_appointments
      FROM patients p 
      WHERE p.phone_number = ?`,
      [phoneNumber],
      (err, row) => {
        if (err) {
          console.error('Erro ao buscar paciente por telefone:', err);
          reject(err);
          return;
        }
        
        if (!row) {
          resolve(null);
          return;
        }
        
        // Descriptografar CPF se necessário
        if (row.cpf && row.cpf.includes(':')) {
          try {
            row.cpf = decrypt(row.cpf);
          } catch (e) {
            console.warn('Erro ao descriptografar CPF:', e.message);
            // Manter valor original se falhar
          }
        }
        
        resolve(row);
      }
    );
  });
};

/**
 * Salva ou atualiza um paciente no banco de dados
 * @param {Object} patientData - Dados do paciente
 * @returns {Promise<Object>} - Paciente salvo com ID
 */
const savePatient = async (patientData) => {
  const { name, cpf, phoneNumber, email = null } = patientData;
  
  // Criptografar CPF antes de salvar
  let encryptedCPF = cpf;
  try {
    encryptedCPF = encrypt(cpf);
  } catch (e) {
    console.warn('Erro ao criptografar CPF:', e.message);
    // Continuar com o valor original se falhar
  }
  
  return new Promise((resolve, reject) => {
    // Verificar se o paciente já existe por telefone
    db.get(
      'SELECT id FROM patients WHERE phone_number = ? LIMIT 1',
      [phoneNumber],
      (err, existingPatient) => {
        if (err) {
          console.error('Erro ao buscar paciente existente:', err);
          reject(err);
          return;
        }
        
        if (existingPatient) {
          // Atualizar paciente existente
          db.run(
            'UPDATE patients SET name = ?, cpf = ?, email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [name, encryptedCPF, email, existingPatient.id],
            function(err) {
              if (err) {
                console.error('Erro ao atualizar paciente:', err);
                reject(err);
                return;
              }
              
              resolve({ 
                id: existingPatient.id, 
                name, 
                cpf, 
                phoneNumber, 
                email,
                updated: true
              });
            }
          );
        } else {
          // Inserir novo paciente
          db.run(
            'INSERT INTO patients (name, cpf, phone_number, email) VALUES (?, ?, ?, ?)',
            [name, encryptedCPF, phoneNumber, email],
            function(err) {
              if (err) {
                console.error('Erro ao inserir paciente:', err);
                reject(err);
                return;
              }
              
              resolve({ 
                id: this.lastID, 
                name, 
                cpf, 
                phoneNumber, 
                email,
                created: true
              });
            }
          );
        }
      }
    );
  });
};

/**
 * Obtém agendamentos de um paciente
 * @param {number} patientId - ID do paciente
 * @returns {Promise<Array>} - Lista de agendamentos
 */
const getPatientAppointments = async (patientId) => {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM appointments WHERE patient_id = ? AND status = "scheduled" ORDER BY start_time ASC',
      [patientId],
      (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows || []);
      }
    );
  });
};

/**
 * Obtém agendamentos de um paciente pelo CPF
 * @param {string} cpf - CPF do paciente
 * @returns {Promise<Array>} - Lista de agendamentos
 */
const getPatientAppointmentsByCPF = async (cpf) => {
  if (!validateCPF(cpf)) {
    console.log('[Patient Service] CPF inválido fornecido:', cpf);
    return [];
  }
  
  return new Promise((resolve, reject) => {
    // Primeiro, buscar os pacientes para lidar com CPFs criptografados
    db.all('SELECT id, cpf FROM patients', [], (err, patients) => {
      if (err) {
        console.error('Erro ao buscar pacientes para verificação de CPF:', err);
        reject(err);
        return;
      }
      
      // Encontrar paciente com o CPF correspondente (possivelmente criptografado)
      let matchedPatientId = null;
      
      for (const patient of patients) {
        if (patient.cpf === cpf) {
          // Comparação direta sem criptografia
          matchedPatientId = patient.id;
          break;
        } else if (patient.cpf && patient.cpf.includes(':')) {
          // Tentar descriptografar
          try {
            const decryptedCPF = decrypt(patient.cpf);
            if (decryptedCPF === cpf) {
              matchedPatientId = patient.id;
              break;
            }
          } catch (e) {
            // Ignorar erros de descriptografia e continuar
            console.warn('Erro ao descriptografar CPF durante busca:', e.message);
          }
        }
      }
      
      if (!matchedPatientId) {
        console.log('[Patient Service] Nenhum paciente encontrado com o CPF:', cpf);
        resolve([]);
        return;
      }
      
      // Com o ID do paciente, buscar os agendamentos
      db.all(
        `SELECT a.* 
         FROM appointments a 
         WHERE a.patient_id = ? AND a.status = "scheduled" 
         ORDER BY a.start_time ASC`,
        [matchedPatientId],
        (err, appointments) => {
          if (err) {
            console.error('Erro ao buscar agendamentos do paciente:', err);
            reject(err);
            return;
          }
          
          resolve(appointments || []);
        }
      );
    });
  });
};

/**
 * Agenda reminders para enviar mensagens automáticas
 * @param {string} phoneNumber - Número para enviar a mensagem
 * @param {Date} appointmentDate - Data e hora da consulta
 * @param {string} patientName - Nome do paciente
 */
const scheduleReminderMessage = (phoneNumber, appointmentDate, patientName) => {
  const { sendTextMessage } = require('../config/whatsappConfig');
  
  try {
    // Validar entrada
    if (!phoneNumber || !appointmentDate || !patientName) {
      console.error('[Reminder] Dados incompletos para agendar lembrete:', { phoneNumber, appointmentDate, patientName });
      return;
    }
    
    // Converter para Date se for string
    if (typeof appointmentDate === 'string') {
      appointmentDate = new Date(appointmentDate);
    }
    
    // Lembrete no dia anterior
    const dayBeforeDate = new Date(appointmentDate);
    dayBeforeDate.setDate(dayBeforeDate.getDate() - 1);
    dayBeforeDate.setHours(10, 0, 0, 0); // Enviar às 10:00
    
    const dayBeforeDelay = dayBeforeDate.getTime() - Date.now();
    if (dayBeforeDelay > 0) {
      console.log(`[Reminder] Agendando lembrete para ${patientName} em ${dayBeforeDate.toISOString()}`);
      
      setTimeout(async () => {
        const formattedDate = new Intl.DateTimeFormat('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        }).format(appointmentDate);
        
        const hours = appointmentDate.getHours().toString().padStart(2, '0');
        const minutes = appointmentDate.getMinutes().toString().padStart(2, '0');
        const formattedTime = `${hours}:${minutes}`;
        
        try {
          await sendTextMessage(
            phoneNumber,
            `Olá ${patientName}! Lembrando que sua consulta com Dr. Reinaldo Ragazzo está agendada para amanhã, ${formattedDate}, às ${formattedTime}. Por favor, chegue 15 minutos antes e traga seus documentos. Até lá! 😊`
          );
          console.log(`[Reminder] Lembrete de véspera enviado para ${phoneNumber}`);
        } catch (error) {
          console.error(`[Reminder] Erro ao enviar lembrete de véspera:`, error);
        }
      }, dayBeforeDelay);
    }
    
    // Lembrete no mesmo dia (3 horas antes)
    const sameDayDate = new Date(appointmentDate);
    sameDayDate.setHours(appointmentDate.getHours() - 3, appointmentDate.getMinutes(), 0, 0);
    
    const sameDayDelay = sameDayDate.getTime() - Date.now();
    if (sameDayDelay > 0) {
      console.log(`[Reminder] Agendando lembrete do mesmo dia para ${patientName} em ${sameDayDate.toISOString()}`);
      
      setTimeout(async () => {
        const hours = appointmentDate.getHours().toString().padStart(2, '0');
        const minutes = appointmentDate.getMinutes().toString().padStart(2, '0');
        const formattedTime = `${hours}:${minutes}`;
        
        try {
          await sendTextMessage(
            phoneNumber,
            `Olá ${patientName}! Sua consulta com Dr. Reinaldo Ragazzo é hoje às ${formattedTime}. Por favor, chegue 15 minutos antes. Estamos aguardando sua visita! 😊`
          );
          console.log(`[Reminder] Lembrete do mesmo dia enviado para ${phoneNumber}`);
        } catch (error) {
          console.error(`[Reminder] Erro ao enviar lembrete do mesmo dia:`, error);
        }
      }, sameDayDelay);
    }
  } catch (error) {
    console.error('[Reminder] Erro ao agendar lembretes:', error);
  }
};

module.exports = {
  validateCPF,
  verifyCPF,
  mapIntentToAppointmentDetails,
  getPatientByPhone,
  getPatientAppointments,
  getPatientAppointmentsByCPF,
  savePatient,
  scheduleReminderMessage,
  encrypt,
  decrypt,
  validateAppointmentDateTime
};