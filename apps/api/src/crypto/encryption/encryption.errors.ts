/**
 * Base error class for all cryptography and encryption operations.
 */
export class EncryptionError extends Error {
  constructor(message = 'Encryption operation failed') {
    super(message);
    this.name = 'EncryptionError';
  }
}

/**
 * Thrown when decryption fails due to authentication tag mismatch, corrupted
 * ciphertext, invalid nonce, wrong key, truncated payload, or unsupported format version.
 *
 * Plaintext secrets, keys, and raw payloads are deliberately excluded from the
 * error message to prevent accidental information leakage in logs or exceptions.
 */
export class DecryptionError extends EncryptionError {
  constructor(
    message = 'Decryption failed: authentication verification failed or ciphertext is corrupted',
  ) {
    super(message);
    this.name = 'DecryptionError';
  }
}

/**
 * Thrown when the master encryption key cannot be loaded, generated, or validated.
 */
export class KeyManagementError extends EncryptionError {
  constructor(message = 'Failed to load or generate master encryption key') {
    super(message);
    this.name = 'KeyManagementError';
  }
}
