//! Módulo de criptografia para dados sensíveis
//!
//! Este módulo implementa as primitivas de criptografia para proteger
//! dados sensíveis no banco de dados e em arquivos.

use anyhow::{Context, Result};
use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use chacha20poly1305::{ChaCha20Poly1305, Key as ChaChaKey};
use rand::{RngCore, rngs::OsRng as RandOsRng};
use thiserror::Error;
use zeroize::Zeroize;

/// Erros específicos para operações de criptografia
#[derive(Error, Debug)]
pub enum CryptoError {
    #[error("Falha na criptografia: {0}")]
    EncryptionFailed(String),
    
    #[error("Falha na descriptografia: {0}")]
    DecryptionFailed(String),
    
    #[error("Dados inválidos: {0}")]
    InvalidData(String),
    
    #[error("Configuração de criptografia inválida: {0}")]
    InvalidConfiguration(String),
    
    #[error("Chave mestra não encontrada")]
    MasterKeyNotFound,
}

/// Tamanho do nonce em bytes para AES-GCM
const AES_GCM_NONCE_SIZE: usize = 12;

/// Chave AES-256 para criptografia (com zeroização automática)
#[derive(Clone, Zeroize)]
#[zeroize(drop)]
pub struct EncryptionKey(pub [u8; 32]);

impl EncryptionKey {
    /// Cria uma nova chave aleatória
    pub fn generate() -> Self {
        let mut key = [0u8; 32];
        RandOsRng.fill_bytes(&mut key);
        Self(key)
    }
    
    /// Cria uma chave a partir de bytes existentes
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        if bytes.len() != 32 {
            return Err(CryptoError::InvalidData(
                format!("A chave deve ter 32 bytes, recebeu {}", bytes.len())
            ).into());
        }
        
        let mut key = [0u8; 32];
        key.copy_from_slice(bytes);
        Ok(Self(key))
    }
    
    /// Converte para bytes
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }
}

/// Estrutura que armazena dados criptografados e seu nonce
#[derive(Debug, Clone)]
pub struct EncryptedData {
    /// Dados criptografados
    pub ciphertext: Vec<u8>,
    /// Nonce usado na criptografia
    pub nonce: Vec<u8>,
}

/// Criptografa dados usando AES-256-GCM
pub fn encrypt(data: &[u8], key: &EncryptionKey) -> Result<EncryptedData> {
    // Criar cipher AES-256-GCM
    let aes_key = Key::<Aes256Gcm>::from_slice(key.as_bytes());
    let cipher = Aes256Gcm::new(aes_key);
    
    // Gerar nonce aleatório
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    
    // Criptografar dados
    let ciphertext = cipher.encrypt(&nonce, data)
        .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;
    
    Ok(EncryptedData {
        ciphertext,
        nonce: nonce.to_vec(),
    })
}

/// Descriptografa dados usando AES-256-GCM
pub fn decrypt(encrypted: &EncryptedData, key: &EncryptionKey) -> Result<Vec<u8>> {
    // Criar cipher AES-256-GCM
    let aes_key = Key::<Aes256Gcm>::from_slice(key.as_bytes());
    let cipher = Aes256Gcm::new(aes_key);
    
    // Verificar nonce
    if encrypted.nonce.len() != AES_GCM_NONCE_SIZE {
        return Err(CryptoError::InvalidData(
            format!("Nonce inválido: esperado {} bytes, recebido {}", 
                    AES_GCM_NONCE_SIZE, encrypted.nonce.len())
        ).into());
    }
    
    let nonce = Nonce::from_slice(&encrypted.nonce);
    
    // Descriptografar
    let plaintext = cipher.decrypt(nonce, encrypted.ciphertext.as_ref())
        .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))?;
    
    Ok(plaintext)
}

/// Criptografa uma chave usando ChaCha20-Poly1305 com chave derivada de senha
pub fn wrap_key(key: &EncryptionKey, password: &str) -> Result<EncryptedData> {
    // Na implementação completa, derivaríamos a chave de embrulho usando Argon2id
    // Por hora, usamos um hash simples para demonstração
    let mut wrapping_key = [0u8; 32];
    
    // Simples derivação para demonstração - NÃO USAR EM PRODUÇÃO
    // Na versão completa, usar Argon2id com salt e params adequados
    for (i, byte) in password.as_bytes().iter().enumerate() {
        wrapping_key[i % 32] ^= byte;
    }
    
    // Criar cipher ChaCha20-Poly1305
    let chacha_key = ChaChaKey::from_slice(&wrapping_key);
    let cipher = ChaCha20Poly1305::new(chacha_key);
    
    // Gerar nonce aleatório
    let mut nonce = [0u8; 12];
    RandOsRng.fill_bytes(&mut nonce);
    
    // Criptografar a chave
    let ciphertext = cipher.encrypt(nonce.as_ref().into(), key.as_bytes())
        .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;
    
    Ok(EncryptedData {
        ciphertext,
        nonce: nonce.to_vec(),
    })
}

/// Descriptografa uma chave usando ChaCha20-Poly1305 com chave derivada de senha
pub fn unwrap_key(encrypted: &EncryptedData, password: &str) -> Result<EncryptionKey> {
    // Mesma derivação simplificada da função wrap_key
    let mut wrapping_key = [0u8; 32];
    
    for (i, byte) in password.as_bytes().iter().enumerate() {
        wrapping_key[i % 32] ^= byte;
    }
    
    // Criar cipher ChaCha20-Poly1305
    let chacha_key = ChaChaKey::from_slice(&wrapping_key);
    let cipher = ChaCha20Poly1305::new(chacha_key);
    
    // Verificar nonce
    if encrypted.nonce.len() != 12 {
        return Err(CryptoError::InvalidData(
            format!("Nonce inválido: esperado 12 bytes, recebido {}", encrypted.nonce.len())
        ).into());
    }
    
    // Descriptografar
    let plaintext = cipher.decrypt(encrypted.nonce.as_slice().into(), encrypted.ciphertext.as_ref())
        .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))?;
    
    // Converter em EncryptionKey
    EncryptionKey::from_bytes(&plaintext)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_encryption_decryption() -> Result<()> {
        // Dados de teste
        let data = b"Informacao confidencial do paciente";
        
        // Gerar chave
        let key = EncryptionKey::generate();
        
        // Criptografar
        let encrypted = encrypt(data, &key)?;
        
        // Verificar se o ciphertext é diferente do plaintext
        assert_ne!(&encrypted.ciphertext, data);
        
        // Descriptografar
        let decrypted = decrypt(&encrypted, &key)?;
        
        // Verificar se recuperamos os dados originais
        assert_eq!(&decrypted, data);
        
        Ok(())
    }
    
    #[test]
    fn test_key_wrapping() -> Result<()> {
        // Gerar chave
        let original_key = EncryptionKey::generate();
        
        // Senha para proteger a chave
        let password = "senha-forte-do-admin";
        
        // Encapsular a chave
        let wrapped = wrap_key(&original_key, password)?;
        
        // Desencapsular a chave
        let unwrapped_key = unwrap_key(&wrapped, password)?;
        
        // Verificar se a chave original foi recuperada
        assert_eq!(original_key.as_bytes(), unwrapped_key.as_bytes());
        
        // Tentar com senha errada
        let result = unwrap_key(&wrapped, "senha-errada");
        assert!(result.is_err());
        
        Ok(())
    }
    
    #[test]
    fn test_encryption_with_different_keys() -> Result<()> {
        let data = b"Dados de teste";
        
        // Gerar duas chaves diferentes
        let key1 = EncryptionKey::generate();
        let key2 = EncryptionKey::generate();
        
        // Verificar que as chaves são diferentes
        assert_ne!(key1.as_bytes(), key2.as_bytes());
        
        // Criptografar com a primeira chave
        let encrypted = encrypt(data, &key1)?;
        
        // Tentar descriptografar com a segunda chave (deve falhar)
        let result = decrypt(&encrypted, &key2);
        assert!(result.is_err());
        
        // Descriptografar com a chave correta
        let decrypted = decrypt(&encrypted, &key1)?;
        assert_eq!(&decrypted, data);
        
        Ok(())
    }
}