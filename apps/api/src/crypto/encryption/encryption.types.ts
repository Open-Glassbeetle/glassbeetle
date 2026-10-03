/**
 * Result of an encryption operation.
 */
export interface EncryptedData {
  /**
   * Complete encrypted payload including format version header, ciphertext,
   * and authentication tag.
   *
   * Ready for direct storage in the `provider_credentials.encrypted_value` BLOB column.
   *
   * Format Layout:
   * - Byte 0: Format Version (0x01)
   * - Bytes 1 to (length - 16): AES-256-GCM Ciphertext
   * - Bytes (length - 16) to length: AES-256-GCM Authentication Tag (16 bytes)
   */
  encryptedValue: Buffer;

  /**
   * Alias for `encryptedValue` matching the issue specification terminology.
   */
  ciphertext: Buffer;

  /**
   * Random 12-byte (96-bit) initialization vector (nonce) used for this operation.
   * Ready for direct storage in the `provider_credentials.nonce` BLOB column.
   * A fresh, cryptographically secure random nonce is generated for every encryption.
   */
  nonce: Buffer;
}

/**
 * Options for masking secret credentials for preview display.
 */
export interface MaskKeyOptions {
  /**
   * Number of trailing characters to reveal as a suffix.
   * Defaults to 4.
   */
  suffixLength?: number;

  /**
   * Custom prefix to preserve if present at the start of the key.
   * If omitted, common provider prefixes (e.g. `sk-ant-`, `sk-proj-`, `sk-`)
   * are detected automatically.
   */
  customPrefix?: string;
}

/**
 * Options for configuring EncryptionService.
 */
export interface EncryptionServiceOptions {
  /**
   * Explicit 32-byte master key (as Buffer, 64-char hex string, or 44-char base64 string).
   * When provided, file-based key loading is bypassed.
   */
  masterKey?: Buffer | string;

  /**
   * Explicit path to the master key file.
   * Defaults to the path resolved from AppConfigService or the application data directory.
   */
  keyPath?: string;
}
