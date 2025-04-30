//! Sistema de migrações para banco de dados
//!
//! Este módulo gerencia as migrações do banco de dados SQLite

use anyhow::{Context, Result};
use sqlx::{migrate::MigrateDatabase, sqlite::SqlitePoolOptions, Sqlite, SqlitePool};
use tracing::{error, info};

/// Lista de migrações SQL a serem aplicadas
const MIGRATIONS: &[&str] = &[
    // 001_initial_schema.sql
    r#"
    -- Tabela de pacientes com dados criptografados
    CREATE TABLE IF NOT EXISTS patients (
        id TEXT PRIMARY KEY NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        name_ciphertext BLOB NOT NULL,
        name_nonce BLOB NOT NULL,
        phone_ciphertext BLOB,
        phone_nonce BLOB,
        email_ciphertext BLOB,
        email_nonce BLOB,
        consent_version TEXT,
        consent_timestamp TIMESTAMP,
        consent_scope TEXT, -- JSON com escopo de consentimento
        consent_signature BLOB,
        access_token_hash TEXT
    );
    
    -- Tabela de agendamentos
    CREATE TABLE IF NOT EXISTS appointments (
        id TEXT PRIMARY KEY NOT NULL,
        patient_id TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        scheduled_at TIMESTAMP NOT NULL,
        duration_minutes INTEGER NOT NULL DEFAULT 30,
        status TEXT NOT NULL CHECK (status IN ('scheduled', 'confirmed', 'in_progress', 'completed', 'canceled', 'no_show')),
        type TEXT NOT NULL,
        notes_ciphertext BLOB,
        notes_nonce BLOB,
        source TEXT NOT NULL,
        anamnesis_id TEXT,
        reminder_sent BOOLEAN NOT NULL DEFAULT 0,
        follow_up_sent BOOLEAN NOT NULL DEFAULT 0,
        FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE
    );
    
    -- Tabela de anamneses
    CREATE TABLE IF NOT EXISTS anamneses (
        id TEXT PRIMARY KEY NOT NULL,
        appointment_id TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        data_ciphertext BLOB NOT NULL,
        data_nonce BLOB NOT NULL,
        audio_path TEXT,
        audio_key_ciphertext BLOB,
        audio_key_nonce BLOB,
        transcription_complete BOOLEAN NOT NULL DEFAULT 0,
        diagnosis_ciphertext BLOB,
        diagnosis_nonce BLOB,
        FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE CASCADE
    );
    
    -- Tabela de finanças
    CREATE TABLE IF NOT EXISTS finances (
        id TEXT PRIMARY KEY NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
        category TEXT NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        date DATE NOT NULL,
        description_ciphertext BLOB,
        description_nonce BLOB,
        appointment_id TEXT,
        receipt_path TEXT,
        receipt_key_ciphertext BLOB,
        receipt_key_nonce BLOB,
        FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE SET NULL
    );
    
    -- Tabela de métricas de redes sociais
    CREATE TABLE IF NOT EXISTS social_metrics (
        id TEXT PRIMARY KEY NOT NULL,
        date DATE NOT NULL,
        platform TEXT NOT NULL,
        followers INTEGER NOT NULL DEFAULT 0,
        engagement INTEGER NOT NULL DEFAULT 0,
        reach INTEGER NOT NULL DEFAULT 0,
        impressions INTEGER NOT NULL DEFAULT 0,
        clicks INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL
    );
    
    -- Tabela de chaves mestras
    CREATE TABLE IF NOT EXISTS master_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        active BOOLEAN NOT NULL DEFAULT 0,
        wrapped_key_ciphertext BLOB NOT NULL,
        wrapped_key_nonce BLOB NOT NULL,
        wrapped_key_tag BLOB NOT NULL,
        key_version INTEGER NOT NULL
    );
    
    -- Índices para otimização
    CREATE INDEX IF NOT EXISTS idx_appointments_patient_id ON appointments (patient_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_scheduled_at ON appointments (scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments (status);
    CREATE INDEX IF NOT EXISTS idx_anamneses_appointment_id ON anamneses (appointment_id);
    CREATE INDEX IF NOT EXISTS idx_finances_date ON finances (date);
    CREATE INDEX IF NOT EXISTS idx_finances_type ON finances (type);
    CREATE INDEX IF NOT EXISTS idx_social_metrics_date ON social_metrics (date);
    CREATE INDEX IF NOT EXISTS idx_social_metrics_platform ON social_metrics (platform);
    "#,
    
    // 002_bridge_tables.sql
    r#"
    -- Tabela de integrações entre sistemas
    CREATE TABLE IF NOT EXISTS system_integrations (
        id TEXT PRIMARY KEY NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        source_system TEXT NOT NULL,
        target_system TEXT NOT NULL,
        integration_type TEXT NOT NULL,
        config_json TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT 1
    );
    
    -- Tabela de mapeamento entre IDs de sistemas
    CREATE TABLE IF NOT EXISTS entity_mappings (
        id TEXT PRIMARY KEY NOT NULL,
        source_system TEXT NOT NULL,
        source_entity_type TEXT NOT NULL,
        source_entity_id TEXT NOT NULL,
        target_system TEXT NOT NULL,
        target_entity_type TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source_system, source_entity_type, source_entity_id, target_system, target_entity_type)
    );
    
    -- Tabela de eventos de sincronização
    CREATE TABLE IF NOT EXISTS sync_events (
        id TEXT PRIMARY KEY NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        source_system TEXT NOT NULL,
        target_system TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
        error_message TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TIMESTAMP
    );
    
    -- Índices para otimização
    CREATE INDEX IF NOT EXISTS idx_entity_mappings_source ON entity_mappings (source_system, source_entity_type, source_entity_id);
    CREATE INDEX IF NOT EXISTS idx_entity_mappings_target ON entity_mappings (target_system, target_entity_type, target_entity_id);
    CREATE INDEX IF NOT EXISTS idx_sync_events_status ON sync_events (status);
    CREATE INDEX IF NOT EXISTS idx_sync_events_entity ON sync_events (entity_type, entity_id);
    "#,
];

/// Executa todas as migrações pendentes no banco de dados
pub async fn run_migrations(pool: &SqlitePool) -> Result<()> {
    info!("Aplicando migrações de banco de dados...");
    
    // Obter a versão atual do banco de dados
    let mut version: i64 = 0;
    match sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(pool)
        .await
    {
        Ok(v) => version = v,
        Err(e) => {
            error!("Erro ao obter versão do banco: {}", e);
            // Continuar mesmo assim, pois pode ser a primeira execução
        }
    }
    
    info!("Versão atual do banco: {}", version);
    
    // Aplicar cada migração pendente sequencialmente
    for (i, migration_sql) in MIGRATIONS.iter().enumerate() {
        let migration_version = (i + 1) as i64;
        
        // Pular migrações já aplicadas
        if migration_version <= version {
            info!("Migração {} já aplicada", migration_version);
            continue;
        }
        
        info!("Aplicando migração {}...", migration_version);
        
        // Executar em uma transação para garantir atomicidade
        let mut transaction = pool.begin().await
            .context(format!("Falha ao iniciar transação para migração {}", migration_version))?;
            
        // Executar os comandos SQL
        sqlx::query(migration_sql)
            .execute(&mut transaction)
            .await
            .context(format!("Falha ao executar migração {}", migration_version))?;
            
        // Atualizar versão do banco
        sqlx::query(&format!("PRAGMA user_version = {}", migration_version))
            .execute(&mut transaction)
            .await
            .context(format!("Falha ao atualizar versão para {}", migration_version))?;
            
        // Commit da transação
        transaction.commit().await
            .context(format!("Falha ao confirmar transação para migração {}", migration_version))?;
            
        info!("Migração {} aplicada com sucesso", migration_version);
    }
    
    info!("Migrações concluídas. Versão atual: {}", MIGRATIONS.len());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqliteConnectOptions;
    use std::path::Path;
    use tempfile::tempdir;
    
    #[tokio::test]
    async fn test_migrations() -> Result<()> {
        // Usar diretório temporário para testes
        let temp_dir = tempdir()?;
        let db_path = temp_dir.path().join("test_migrations.db");
        let db_url = format!("sqlite:{}", db_path.display());
        
        // Criar banco de dados
        Sqlite::create_database(&db_url).await?;
        
        // Conectar
        let conn_options = SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(true);
            
        let pool = SqlitePool::connect_with(conn_options).await?;
        
        // Aplicar migrações
        run_migrations(&pool).await?;
        
        // Verificar versão do banco
        let version: i64 = sqlx::query_scalar("PRAGMA user_version")
            .fetch_one(&pool)
            .await?;
            
        assert_eq!(version, MIGRATIONS.len() as i64);
        
        // Verificar se tabelas foram criadas
        let tables: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
        .fetch_all(&pool)
        .await?;
        
        // Verificar algumas tabelas esperadas
        assert!(tables.contains(&"patients".to_string()));
        assert!(tables.contains(&"appointments".to_string()));
        assert!(tables.contains(&"anamneses".to_string()));
        assert!(tables.contains(&"finances".to_string()));
        assert!(tables.contains(&"master_keys".to_string()));
        assert!(tables.contains(&"system_integrations".to_string()));
        
        Ok(())
    }
}