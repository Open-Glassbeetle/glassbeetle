import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import { resolveDefaultDataDir, resolveDefaultMasterKeyPath } from '../../config/data-dir.js';
import { DecryptionError, KeyManagementError } from './encryption.errors.js';
import type { EncryptedData, EncryptionServiceOptions, MaskKeyOptions } from './encryption.types.js';
import { maskKey } from './mask-key.js';

/**
 * Format version byte for AES-256-GCM encrypted values.
 *
 * Prepended to the ciphertext so future migrations (e.g. post-quantum ciphers,
 * key rotation, or different tag layouts) can identify and decode legacy records.
 */
export const ENCRYPTION_FORMAT_VERSION_V1 = 0x01;

/**
 * Standard AES-256-GCM initialization vector (nonce) byte length.
 * 96-bit (12 bytes) is the recommended and optimal nonce length for GCM.
 */
export const GCM_NONCE_LENGTH = 12;

/**
 * Standard AES-GCM authentication tag byte length (128 bits / 16 bytes).
 */
export const GCM_AUTH_TAG_LENGTH = 16;

/**
 * Minimum byte length of `encrypted_value` payload:
 * 1 byte (version) + 0 bytes (empty ciphertext) + 16 bytes (auth tag) = 17 bytes.
 */
export const MIN_ENCRYPTED_VALUE_LENGTH = 1 + GCM_AUTH_TAG_LENGTH;

/**
 * Authenticated Encryption Service for provider credentials and sensitive data at rest.
 *
 * ## Cryptographic Scheme
 * - Cipher: AES-256-GCM (`aes-256-gcm`) via `node:crypto`.
 * - Nonce (IV): 12-byte (96-bit) cryptographically secure random bytes per encryption.
 *   Nonces are NEVER reused across operations.
 * - Authentication Tag: 16-byte (128-bit) GCM authentication tag verifying ciphertext integrity.
 * - Additional Authenticated Data (AAD): Optional binding (e.g. `provider_id`) ensuring
 *   a ciphertext cannot be transplanted from one database record to another.
 *
 * ## Wire and On-Disk Layout
 * Stored in SQLite table `provider_credentials`:
 * - `nonce` BLOB: 12 raw bytes (the 96-bit AES-GCM IV).
 * - `encrypted_value` BLOB:
 *   - Byte 0: Format Version Byte (`0x01` for Version 1)
 *   - Bytes 1 .. (length - 16): AES-256-GCM Ciphertext (N bytes)
 *   - Bytes (length - 16) .. length: AES-256-GCM Authentication Tag (16 bytes)
 * - `masked_preview` TEXT: Masked representation produced by `maskKey` (e.g. `sk-ant-…4f2a`).
 *
 * ## Master Key Management & Threat Model
 * Glassbeetle stores a 256-bit (32-byte) master key in a dedicated file (`master.key`)
 * located in the application data directory with restrictive permissions (`0600` on POSIX).
 *
 * ### What this protects against:
 * 1. Database exfiltration / leaks: If the SQLite database (`glassbeetle.db`) is leaked,
 *    shared, accidentally committed to a repository, synced to untrusted cloud storage,
 *    or extracted via SQL injection, an attacker cannot decrypt provider credentials
 *    without obtaining the separate `master.key` file.
 * 2. Accidental exposure: SQLite inspection tools, query logs, or local database browsing
 *    only expose high-entropy binary blobs, not plaintext API keys.
 * 3. Tampering: Any modification to ciphertext, nonce, or tag triggers authentication
 *    failure and throws an exception, rejecting corrupted or forged keys.
 * 4. Record swapping: When `provider_id` is supplied as AAD, credentials cannot be moved
 *    between provider rows.
 *
 * ### What this DOES NOT protect against:
 * 1. Full host / user account compromise: An attacker or process executing with the same
 *    user privileges on the local machine can read both `glassbeetle.db` and `master.key`.
 * 2. Root / Administrator access: Privileged administrative accounts can bypass file permissions.
 * 3. Memory inspection: Active plaintext keys and the master key temporarily reside in process
 *    RAM during cryptographic operations and provider API invocations.
 *
 * ### Backup Considerations:
 * - A database backup omitting `master.key` cannot restore usable provider credentials.
 * - A database backup bundling `master.key` alongside the database defeats at-rest separation.
 * - Recommended follow-up: Export bundles should either require a user-supplied passphrase
 *   to encrypt credentials on export, or exclude provider credentials, prompting the user
 *   to re-enter API keys upon restoring to a new device.
 */
@Injectable()
export class EncryptionService {
  private masterKey: Buffer | null = null;
  private readonly keyPath: string;

  constructor(
    @Optional() private readonly appConfig?: AppConfigService,
    @Optional() options?: EncryptionServiceOptions,
  ) {
    if (options?.masterKey) {
      this.masterKey = this.normalizeKey(options.masterKey);
    }

    const dataDir =
      this.appConfig?.dataDir ??
      (process.env.GLASSBEETLE_DATA_DIR?.trim()
        ? process.env.GLASSBEETLE_DATA_DIR.trim()
        : resolveDefaultDataDir());

    this.keyPath =
      options?.keyPath ??
      this.appConfig?.masterKeyPath ??
      (process.env.GLASSBEETLE_MASTER_KEY_FILE?.trim()
        ? process.env.GLASSBEETLE_MASTER_KEY_FILE.trim()
        : resolveDefaultMasterKeyPath(dataDir));
  }

  /**
   * Encrypts plaintext using AES-256-GCM with a fresh random 96-bit nonce.
   *
   * @param plaintext Plaintext string or buffer to encrypt.
   * @param associatedData Optional additional authenticated data (AAD) bound to the ciphertext
   *                       (for example `provider_id` to prevent swapping across rows).
   * @returns EncryptedData containing `encryptedValue`, `ciphertext` alias, and `nonce`.
   */
  public encrypt(
    plaintext: string | Buffer,
    associatedData?: string | Buffer,
  ): EncryptedData {
    const plainBuf = Buffer.isBuffer(plaintext)
      ? plaintext
      : Buffer.from(plaintext, 'utf-8');

    const nonce = randomBytes(GCM_NONCE_LENGTH);
    const key = this.getMasterKey();

    const cipher = createCipheriv('aes-256-gcm', key, nonce);

    if (associatedData !== undefined && associatedData !== '') {
      const aadBuf = Buffer.isBuffer(associatedData)
        ? associatedData
        : Buffer.from(associatedData, 'utf-8');
      cipher.setAAD(aadBuf);
    }

    const ciphertext = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Wire format: [Version (1 byte)][Ciphertext (N bytes)][Auth Tag (16 bytes)]
    const versionHeader = Buffer.from([ENCRYPTION_FORMAT_VERSION_V1]);
    const encryptedValue = Buffer.concat([versionHeader, ciphertext, authTag]);

    return {
      encryptedValue,
      ciphertext: encryptedValue,
      nonce,
    };
  }

  /**
   * Decrypts an authenticated ciphertext payload and verifies its integrity.
   *
   * @param encryptedValue Complete encrypted payload (including version byte and authentication tag).
   * @param nonce 12-byte random initialization vector used during encryption.
   * @param associatedData Optional additional authenticated data that was bound during encryption.
   * @returns Decrypted plaintext string.
   * @throws DecryptionError if verification fails, data was tampered with, or parameters are invalid.
   */
  public decrypt(
    encryptedValue: Buffer | Uint8Array,
    nonce: Buffer | Uint8Array,
    associatedData?: string | Buffer,
  ): string {
    const decryptedBuffer = this.decryptToBuffer(
      encryptedValue,
      nonce,
      associatedData,
    );
    return decryptedBuffer.toString('utf-8');
  }

  /**
   * Decrypts an authenticated ciphertext payload returning the raw plaintext Buffer.
   *
   * @param encryptedValue Complete encrypted payload (including version byte and authentication tag).
   * @param nonce 12-byte random initialization vector used during encryption.
   * @param associatedData Optional additional authenticated data that was bound during encryption.
   * @returns Decrypted plaintext Buffer.
   * @throws DecryptionError if verification fails, data was tampered with, or parameters are invalid.
   */
  public decryptToBuffer(
    encryptedValue: Buffer | Uint8Array,
    nonce: Buffer | Uint8Array,
    associatedData?: string | Buffer,
  ): Buffer {
    const encBuf = Buffer.isBuffer(encryptedValue)
      ? encryptedValue
      : Buffer.from(encryptedValue);

    const nonceBuf = Buffer.isBuffer(nonce) ? nonce : Buffer.from(nonce);

    if (nonceBuf.length !== GCM_NONCE_LENGTH) {
      throw new DecryptionError('Decryption failed: invalid nonce length');
    }

    if (encBuf.length < MIN_ENCRYPTED_VALUE_LENGTH) {
      throw new DecryptionError('Decryption failed: invalid ciphertext payload');
    }

    const version = encBuf[0];
    if (version !== ENCRYPTION_FORMAT_VERSION_V1) {
      throw new DecryptionError(
        `Decryption failed: unsupported encryption version byte (${version})`,
      );
    }

    const authTag = encBuf.subarray(encBuf.length - GCM_AUTH_TAG_LENGTH);
    const ciphertext = encBuf.subarray(1, encBuf.length - GCM_AUTH_TAG_LENGTH);

    const key = this.getMasterKey();
    const decipher = createDecipheriv('aes-256-gcm', key, nonceBuf);
    decipher.setAuthTag(authTag);

    if (associatedData !== undefined && associatedData !== '') {
      const aadBuf = Buffer.isBuffer(associatedData)
        ? associatedData
        : Buffer.from(associatedData, 'utf-8');
      decipher.setAAD(aadBuf);
    }

    try {
      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      return decrypted;
    } catch {
      // Intentionally omit key, nonce, ciphertext, or plaintext details from error messages
      throw new DecryptionError(
        'Decryption failed: authentication verification failed or ciphertext is corrupted',
      );
    }
  }

  /**
   * Masks a secret credential for safe preview display (e.g. `sk-ant-…4f2a`).
   *
   * @param key Plaintext credential to mask.
   * @param options Optional masking options.
   * @returns Masked preview string.
   */
  public maskKey(
    key: string | null | undefined,
    options?: MaskKeyOptions,
  ): string {
    return maskKey(key, options);
  }

  /**
   * Static helper for masking credentials without instantiating the service.
   */
  public static maskKey(
    key: string | null | undefined,
    options?: MaskKeyOptions,
  ): string {
    return maskKey(key, options);
  }

  /**
   * Resolves the 256-bit (32-byte) master key.
   *
   * Loading order:
   * 1. In-memory / constructor override key
   * 2. `GLASSBEETLE_MASTER_KEY` environment variable
   * 3. Key file at resolved `keyPath` (generated on first run with 0600 permissions if absent)
   */
  public getMasterKey(): Buffer {
    if (this.masterKey) {
      return this.masterKey;
    }

    const envKey = process.env.GLASSBEETLE_MASTER_KEY?.trim();
    if (envKey) {
      this.masterKey = this.normalizeKey(envKey);
      return this.masterKey;
    }

    this.masterKey = this.loadOrCreateKeyFile(this.keyPath);
    return this.masterKey;
  }

  /**
   * Resolves or generates the master key file.
   */
  private loadOrCreateKeyFile(filePath: string): Buffer {
    try {
      if (existsSync(filePath)) {
        const content = readFileSync(filePath);
        return this.parseAndValidateKey(content, filePath);
      }

      // First run: generate 256-bit cryptographic key
      const newKey = randomBytes(32);
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
      }

      // Write with owner-only read/write permissions (0o600)
      writeFileSync(filePath, newKey, { mode: 0o600, flag: 'wx' });

      try {
        chmodSync(filePath, 0o600);
      } catch {
        // Ignored on platforms without POSIX chmod support (e.g. Windows)
      }

      return newKey;
    } catch (error) {
      // Handle race condition where another process created the file simultaneously
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'EEXIST'
      ) {
        const content = readFileSync(filePath);
        return this.parseAndValidateKey(content, filePath);
      }

      if (error instanceof KeyManagementError) {
        throw error;
      }

      throw new KeyManagementError(
        `Failed to initialize master key at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Normalizes and validates an arbitrary input key into a 32-byte Buffer.
   */
  private normalizeKey(rawKey: Buffer | string): Buffer {
    if (Buffer.isBuffer(rawKey)) {
      if (rawKey.length === 32) {
        return rawKey;
      }
      return this.parseAndValidateKey(rawKey, 'provided buffer key');
    }

    const trimmed = rawKey.trim();
    return this.parseAndValidateKey(Buffer.from(trimmed), 'provided string key');
  }

  /**
   * Parses raw buffer content into a 32-byte key, supporting raw binary, hex, or base64.
   */
  private parseAndValidateKey(content: Buffer, sourceName: string): Buffer {
    if (content.length === 32) {
      return content;
    }

    const text = content.toString('utf-8').trim();

    // 64-char hex string
    if (text.length === 64 && /^[0-9a-fA-F]{64}$/.test(text)) {
      return Buffer.from(text, 'hex');
    }

    // 44-char base64 string
    if (text.length === 44 && /^[A-Za-z0-9+/]{43}=$/.test(text)) {
      const decoded = Buffer.from(text, 'base64');
      if (decoded.length === 32) {
        return decoded;
      }
    }

    throw new KeyManagementError(
      `Master key from ${sourceName} is invalid: must be exactly 32 bytes (received ${content.length} bytes)`,
    );
  }
}
