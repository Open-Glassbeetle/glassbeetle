/**
 * Public surface of the crypto area: the module, the encryption service, its
 * error types, its option and result types, and the credential masking helper.
 */
export * from './crypto.module.js';
export * from './encryption/encryption.service.js';
export * from './encryption/encryption.errors.js';
export * from './encryption/encryption.types.js';
export * from './encryption/mask-key.js';
