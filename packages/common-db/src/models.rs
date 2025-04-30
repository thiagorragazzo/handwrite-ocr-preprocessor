//! Modelos de dados compartilhados entre aplicações
//!
//! Este módulo define as estruturas de dados principais usadas pelo ecossistema da clínica

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqliteRow;
use sqlx::{FromRow, Row};
use uuid::Uuid;

/// Status possíveis de um agendamento
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AppointmentStatus {
    /// Agendamento inicial, pendente de confirmação
    Scheduled,
    /// Confirmado pelo paciente
    Confirmed,
    /// Consulta em andamento
    InProgress,
    /// Consulta concluída
    Completed,
    /// Cancelado
    Canceled,
    /// Paciente não compareceu
    NoShow,
}

impl std::fmt::Display for AppointmentStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppointmentStatus::Scheduled => write!(f, "scheduled"),
            AppointmentStatus::Confirmed => write!(f, "confirmed"),
            AppointmentStatus::InProgress => write!(f, "in_progress"),
            AppointmentStatus::Completed => write!(f, "completed"),
            AppointmentStatus::Canceled => write!(f, "canceled"),
            AppointmentStatus::NoShow => write!(f, "no_show"),
        }
    }
}

impl FromRow<'_, SqliteRow> for AppointmentStatus {
    fn from_row(row: &SqliteRow) -> sqlx::Result<Self> {
        let status: String = row.try_get(0)?;
        match status.as_str() {
            "scheduled" => Ok(AppointmentStatus::Scheduled),
            "confirmed" => Ok(AppointmentStatus::Confirmed),
            "in_progress" => Ok(AppointmentStatus::InProgress),
            "completed" => Ok(AppointmentStatus::Completed),
            "canceled" => Ok(AppointmentStatus::Canceled),
            "no_show" => Ok(AppointmentStatus::NoShow),
            _ => Err(sqlx::Error::ColumnDecode {
                index: String::from("status"),
                source: Box::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("Valor de status inválido: {}", status),
                )),
            }),
        }
    }
}

/// Representa uma consulta/agendamento
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Appointment {
    /// Identificador único da consulta
    pub id: Uuid,
    /// Identificador do paciente
    pub patient_id: Uuid,
    /// Data e hora de criação do registro
    pub created_at: DateTime<Utc>,
    /// Data e hora agendada para a consulta
    pub scheduled_at: DateTime<Utc>,
    /// Duração prevista em minutos
    pub duration_minutes: i32,
    /// Status atual da consulta
    pub status: AppointmentStatus,
    /// Tipo de consulta (primeira vez, retorno, etc.)
    pub appointment_type: String,
    /// Origem do agendamento (WhatsApp, telefone, site)
    pub source: String,
    /// ID da anamnese associada (quando concluída)
    pub anamnesis_id: Option<Uuid>,
    /// Indica se o lembrete foi enviado
    pub reminder_sent: bool,
    /// Indica se o contato pós-consulta foi enviado
    pub follow_up_sent: bool,
}

impl FromRow<'_, SqliteRow> for Appointment {
    fn from_row(row: &SqliteRow) -> sqlx::Result<Self> {
        Ok(Self {
            id: row.try_get("id")?,
            patient_id: row.try_get("patient_id")?,
            created_at: row.try_get("created_at")?,
            scheduled_at: row.try_get("scheduled_at")?,
            duration_minutes: row.try_get("duration_minutes")?,
            status: AppointmentStatus::from_row(&row.try_get::<String, _>("status")?.into())?,
            appointment_type: row.try_get("type")?,
            source: row.try_get("source")?,
            anamnesis_id: row.try_get("anamnesis_id")?,
            reminder_sent: row.try_get("reminder_sent")?,
            follow_up_sent: row.try_get("follow_up_sent")?,
        })
    }
}

/// Versão simplificada de agendamento para uso em APIs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppointmentSummary {
    /// Identificador único da consulta
    pub id: Uuid,
    /// Nome do paciente (descriptografado)
    pub patient_name: String,
    /// Data e hora agendada para a consulta
    pub scheduled_at: DateTime<Utc>,
    /// Duração prevista em minutos
    pub duration_minutes: i32,
    /// Status atual da consulta
    pub status: AppointmentStatus,
    /// Tipo de consulta
    pub appointment_type: String,
}

/// Transição de estado de um agendamento
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppointmentStatusChange {
    /// ID do agendamento
    pub appointment_id: Uuid,
    /// Novo status
    pub new_status: AppointmentStatus,
    /// Motivo da mudança (opcional)
    pub reason: Option<String>,
}

/// Dados de anamnese - versão encriptada
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedAnamnesis {
    /// Identificador único
    pub id: Uuid,
    /// ID do agendamento relacionado
    pub appointment_id: Uuid,
    /// Data e hora de criação
    pub created_at: DateTime<Utc>,
    /// Data e hora da última atualização
    pub updated_at: DateTime<Utc>,
    /// Dados do formulário criptografados
    pub data_ciphertext: Vec<u8>,
    /// Nonce para os dados
    pub data_nonce: Vec<u8>,
    /// Caminho para o arquivo de áudio
    pub audio_path: Option<String>,
    /// Chave do áudio criptografada
    pub audio_key_ciphertext: Option<Vec<u8>>,
    /// Nonce para a chave de áudio
    pub audio_key_nonce: Option<Vec<u8>>,
    /// Indica se a transcrição está completa
    pub transcription_complete: bool,
    /// Hipóteses diagnósticas criptografadas
    pub diagnosis_ciphertext: Option<Vec<u8>>,
    /// Nonce para o diagnóstico
    pub diagnosis_nonce: Option<Vec<u8>>,
}

/// Modelo para registrar métricas de redes sociais
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialMetrics {
    /// Identificador único
    pub id: Uuid,
    /// Data da métrica
    pub date: chrono::NaiveDate,
    /// Plataforma (Instagram, Facebook, etc.)
    pub platform: String,
    /// Número de seguidores
    pub followers: i32,
    /// Engajamento (likes, comentários, etc.)
    pub engagement: i32,
    /// Alcance
    pub reach: i32,
    /// Impressões
    pub impressions: i32,
    /// Cliques
    pub clicks: i32,
    /// Origem dos dados (API, Manual)
    pub source: String,
}

/// Registro da chave mestra criptografada
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MasterKey {
    /// Identificador único
    pub id: i32,
    /// Data e hora de criação
    pub created_at: DateTime<Utc>,
    /// Indica se esta é a chave ativa
    pub active: bool,
    /// Chave mestra criptografada com senha do admin
    pub wrapped_key_ciphertext: Vec<u8>,
    /// Nonce para a chave mestra
    pub wrapped_key_nonce: Vec<u8>,
    /// Tag para autenticação
    pub wrapped_key_tag: Vec<u8>,
    /// Versão da chave
    pub key_version: i32,
}