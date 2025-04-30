//! Definições de erro para a biblioteca common-db
//! 
//! Este módulo define os tipos de erro usados pela biblioteca

use thiserror::Error;

/// Erros específicos para operações de banco de dados
#[derive(Error, Debug)]
pub enum DbError {
    #[error("Erro de conexão com banco de dados: {0}")]
    ConnectionError(String),
    
    #[error("Erro de migração: {0}")]
    MigrationError(String),
    
    #[error("Erro de consulta: {0}")]
    QueryError(String),
    
    #[error("Entidade não encontrada: {0}")]
    NotFound(String),
    
    #[error("Violação de restrição: {0}")]
    ConstraintViolation(String),
    
    #[error("Erro de criptografia: {0}")]
    CryptoError(String),
    
    #[error("Erro interno: {0}")]
    InternalError(String),
}

/// Conversão de erros específicos do SQLx para nossos tipos de erro
impl From<sqlx::Error> for DbError {
    fn from(error: sqlx::Error) -> Self {
        match error {
            sqlx::Error::RowNotFound => DbError::NotFound("Registro não encontrado".to_string()),
            sqlx::Error::Database(dbe) => {
                if let Some(code) = dbe.code() {
                    if code.as_ref() == "23000" || code.as_ref() == "2067" {
                        return DbError::ConstraintViolation(dbe.message().to_string());
                    }
                }
                DbError::QueryError(dbe.message().to_string())
            },
            sqlx::Error::ColumnNotFound(col) => 
                DbError::QueryError(format!("Coluna não encontrada: {}", col)),
            sqlx::Error::TypeNotFound { type_name } => 
                DbError::QueryError(format!("Tipo não encontrado: {}", type_name)),
            sqlx::Error::ColumnDecode { index, source } => 
                DbError::QueryError(format!("Erro ao decodificar coluna {}: {}", index, source)),
            sqlx::Error::Io(io_err) => 
                DbError::ConnectionError(io_err.to_string()),
            sqlx::Error::Configuration(conf_err) => 
                DbError::ConnectionError(conf_err.to_string()),
            sqlx::Error::PoolClosed => 
                DbError::ConnectionError("Pool de conexões fechado".to_string()),
            sqlx::Error::PoolTimedOut => 
                DbError::ConnectionError("Timeout no pool de conexões".to_string()),
            sqlx::Error::WorkerCrashed => 
                DbError::InternalError("Worker do banco de dados falhou".to_string()),
            _ => DbError::InternalError(format!("Erro inesperado: {:?}", error)),
        }
    }
}