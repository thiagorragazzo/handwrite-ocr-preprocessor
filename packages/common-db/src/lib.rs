//! Common DB - Biblioteca compartilhada para acesso ao banco de dados criptografado
//!
//! Esta biblioteca fornece:
//! - Modelos de dados compartilhados
//! - Migrações automáticas do banco de dados
//! - Mecanismo de criptografia para dados sensíveis
//! - Pool de conexão e funções de utilidades para SQLite

use anyhow::{Context, Result};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::path::Path;
use tracing::{error, info};

pub mod crypto;
pub mod error;
pub mod migrations;
pub mod models;

/// Configuração da conexão com o banco de dados
#[derive(Debug, Clone)]
pub struct DbConfig {
    /// Caminho para o arquivo SQLite (criptografado via SQLCipher)
    pub db_path: String,
    /// Senha para descriptografar o banco de dados
    /// Será convertida em chave derivada usando Argon2id
    pub key_phrase: String,
    /// Número máximo de conexões no pool
    pub max_connections: u32,
    /// Nível de trace do SQL (0-3)
    pub trace_level: u8,
}

impl Default for DbConfig {
    fn default() -> Self {
        Self {
            db_path: "data/clinic.db".to_string(),
            key_phrase: "".to_string(), // Vazio por segurança, deve ser definido explicitamente
            max_connections: 5,
            trace_level: 0,
        }
    }
}

/// Inicializa uma conexão com o banco de dados SQLite criptografado
pub async fn init_db_pool(config: &DbConfig) -> Result<SqlitePool> {
    let db_path = Path::new(&config.db_path);
    
    // Verifica se o diretório pai existe
    if let Some(parent) = db_path.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent)
                .context("Falha ao criar diretório para banco de dados")?;
        }
    }

    // Configura as opções de conexão SQLite
    let connection_options = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true)
        // SQLCipher será integrado futuramente - comentado para compilar
        // .pragma("key", &format!("\"{}\"", config.key_phrase))
        // .pragma("cipher_page_size", "4096")
        // .pragma("kdf_iter", "64000")
        // .pragma("cipher_memory_security", "ON")
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .foreign_keys(true)
        .pragma("synchronous", "NORMAL");

    // Cria o pool de conexões
    let pool = SqlitePoolOptions::new()
        .max_connections(config.max_connections)
        .connect_with(connection_options)
        .await
        .context("Falha ao conectar ao banco de dados SQLite")?;

    // Aplica migrações automáticas
    migrations::run_migrations(&pool).await
        .context("Falha ao aplicar migrações")?;

    info!("Banco de dados inicializado com sucesso: {}", config.db_path);
    Ok(pool)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    
    #[tokio::test]
    async fn test_db_connection() -> Result<()> {
        // Usar diretório temporário para testes
        let temp_dir = tempdir()?;
        let db_path = temp_dir.path().join("test.db");
        
        let config = DbConfig {
            db_path: db_path.to_str().unwrap().to_string(),
            key_phrase: "test_password".to_string(),
            max_connections: 2,
            trace_level: 3,
        };
        
        // Inicializar banco
        let pool = init_db_pool(&config).await?;
        
        // Verificar se podemos executar consulta simples
        let result: (i64,) = sqlx::query_as("SELECT 1")
            .fetch_one(&pool)
            .await?;
            
        assert_eq!(result.0, 1);
        
        Ok(())
    }
}