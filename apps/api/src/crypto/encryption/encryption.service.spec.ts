import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { describe, beforeEach, afterEach, expect, it } from 'vitest';
import { CryptoModule } from '../crypto.module.js';
import { EncryptionService } from './encryption.service.js';
import { DecryptionError, KeyManagementError } from './encryption.errors.js';
import { DatabaseService } from '../../database/database.service.js';
import { AppConfigModule } from '../../config/config.module.js';

describe('EncryptionService', () => {
  let service: EncryptionService;
  let tempDir: string;
  let keyPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'gb-encryption-test-'));
    keyPath = join(tempDir, 'master.key');
    service = new EncryptionService(undefined, { keyPath });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignored
    }
  });

  describe('Nest DI and Module Export', () => {
    it('is exported from CryptoModule and resolvable via Nest testing module', async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [AppConfigModule, CryptoModule],
      }).compile();

      const injectedService = module.get<EncryptionService>(EncryptionService);
      expect(injectedService).toBeDefined();
      expect(typeof injectedService.encrypt).toBe('function');
      expect(typeof injectedService.decrypt).toBe('function');
    });
  });

  describe('Key Generation & Permissions', () => {
    it('generates a 32-byte key on first run with restrictive file permissions (0600 on POSIX)', () => {
      expect(existsSync(keyPath)).toBe(false);

      const key = service.getMasterKey();
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
      expect(existsSync(keyPath)).toBe(true);

      const diskKey = readFileSync(keyPath);
      expect(diskKey.equals(key)).toBe(true);

      // Verify file permissions on POSIX systems (macOS, Linux)
      if (process.platform !== 'win32') {
        const stats = statSync(keyPath);
        const mode = stats.mode & 0o777;
        expect(mode).toBe(0o600);
      }
    });

    it('reuses existing master key on subsequent service instances without overwriting', () => {
      const initialKey = service.getMasterKey();

      const secondService = new EncryptionService(undefined, { keyPath });
      const secondKey = secondService.getMasterKey();

      expect(secondKey.equals(initialKey)).toBe(true);
    });

    it('supports 64-character hex encoded key files', () => {
      const rawSecret = randomBytes(32);
      writeFileSync(keyPath, rawSecret.toString('hex'), { mode: 0o600 });

      const customService = new EncryptionService(undefined, { keyPath });
      const loadedKey = customService.getMasterKey();

      expect(loadedKey.equals(rawSecret)).toBe(true);
    });

    it('throws KeyManagementError if key file length is invalid', () => {
      writeFileSync(keyPath, Buffer.from('too-short-key-16b'), { mode: 0o600 });

      const customService = new EncryptionService(undefined, { keyPath });
      expect(() => customService.getMasterKey()).toThrow(KeyManagementError);
    });

    it('honours GLASSBEETLE_MASTER_KEY environment variable override', () => {
      const envKeyHex = randomBytes(32).toString('hex');
      const originalEnv = process.env.GLASSBEETLE_MASTER_KEY;
      try {
        process.env.GLASSBEETLE_MASTER_KEY = envKeyHex;
        const envService = new EncryptionService();
        const key = envService.getMasterKey();
        expect(key.equals(Buffer.from(envKeyHex, 'hex'))).toBe(true);
      } finally {
        if (originalEnv !== undefined) {
          process.env.GLASSBEETLE_MASTER_KEY = originalEnv;
        } else {
          delete process.env.GLASSBEETLE_MASTER_KEY;
        }
      }
    });
  });

  describe('Authenticated Encryption & Decryption', () => {
    it('encrypt/decrypt round trip recovers the exact plaintext, including non-ASCII input', () => {
      const testCases = [
        'sk-ant-api03-simple-ascii-key-12345',
        'sk-proj-ümläüte-and-ß-keys-日本語-🔑-rocket-🚀',
        '', // Empty string
        'Multi-line\nSecret\r\nToken\tWith Whitespace   ',
        'Special characters: !@#$%^&*()_+=-`~[]\\{}|;\':",./<>?',
      ];

      for (const plaintext of testCases) {
        const { encryptedValue, nonce } = service.encrypt(plaintext);
        const decrypted = service.decrypt(encryptedValue, nonce);
        expect(decrypted).toBe(plaintext);
      }
    });

    it('supports encrypting and decrypting raw Buffer values', () => {
      const rawData = randomBytes(64);
      const { encryptedValue, nonce } = service.encrypt(rawData);
      const decryptedBuf = service.decryptToBuffer(encryptedValue, nonce);
      expect(decryptedBuf.equals(rawData)).toBe(true);
    });

    it('returns both encryptedValue and ciphertext alias', () => {
      const result = service.encrypt('test-key');
      expect(result.encryptedValue).toBeDefined();
      expect(result.ciphertext).toBeDefined();
      expect(result.encryptedValue.equals(result.ciphertext)).toBe(true);
      expect(result.nonce.length).toBe(12);
    });

    it('two encryptions of the same plaintext produce different ciphertexts (nonce is not reused)', () => {
      const plaintext = 'sk-ant-api03-static-constant-api-key';
      const enc1 = service.encrypt(plaintext);
      const enc2 = service.encrypt(plaintext);

      expect(enc1.nonce.equals(enc2.nonce)).toBe(false);
      expect(enc1.encryptedValue.equals(enc2.encryptedValue)).toBe(false);

      // But both decrypt back to the original plaintext
      expect(service.decrypt(enc1.encryptedValue, enc1.nonce)).toBe(plaintext);
      expect(service.decrypt(enc2.encryptedValue, enc2.nonce)).toBe(plaintext);
    });

    it('fails loudly when nonce length is not 12 bytes', () => {
      const { encryptedValue } = service.encrypt('valid-plaintext');
      const invalidNonce = Buffer.alloc(16); // 16 bytes instead of 12

      expect(() => service.decrypt(encryptedValue, invalidNonce)).toThrow(
        DecryptionError,
      );
    });

    it('fails loudly when encrypted payload is truncated or has unsupported version', () => {
      const nonce = randomBytes(12);

      // Less than 17 bytes (min length: 1 version + 16 auth tag)
      expect(() => service.decrypt(Buffer.alloc(16), nonce)).toThrow(
        DecryptionError,
      );

      // Unsupported format version byte (e.g. 0x02)
      const invalidVersionPayload = Buffer.alloc(20);
      invalidVersionPayload[0] = 0x02;
      expect(() => service.decrypt(invalidVersionPayload, nonce)).toThrow(
        DecryptionError,
      );
    });

    it('flipping a byte in the ciphertext, the nonce or the tag makes decryption throw', () => {
      const plaintext = 'sk-ant-confidential-api-credential-12345';
      const { encryptedValue, nonce } = service.encrypt(plaintext);

      // 1. Flip a byte in the ciphertext portion (between offset 1 and length - 17)
      const corruptedCiphertext = Buffer.from(encryptedValue);
      const ciphertextOffset = 5;
      corruptedCiphertext[ciphertextOffset] ^= 0x55;
      expect(() => service.decrypt(corruptedCiphertext, nonce)).toThrow(
        DecryptionError,
      );

      // 2. Flip a byte in the auth tag portion (last 16 bytes)
      const corruptedTag = Buffer.from(encryptedValue);
      const tagOffset = corruptedTag.length - 3;
      corruptedTag[tagOffset] ^= 0xaa;
      expect(() => service.decrypt(corruptedTag, nonce)).toThrow(
        DecryptionError,
      );

      // 3. Flip a byte in the nonce
      const corruptedNonce = Buffer.from(nonce);
      corruptedNonce[0] ^= 0x01;
      expect(() => service.decrypt(encryptedValue, corruptedNonce)).toThrow(
        DecryptionError,
      );
    });

    it('decrypting with the wrong key throws rather than returning garbage', () => {
      const plaintext = 'sk-proj-my-secret-key-that-must-never-leak';
      const { encryptedValue, nonce } = service.encrypt(plaintext);

      const wrongKeyDir = mkdtempSync(join(tmpdir(), 'gb-wrong-key-'));
      const wrongKeyPath = join(wrongKeyDir, 'master.key');
      const wrongKeyService = new EncryptionService(undefined, {
        keyPath: wrongKeyPath,
      });

      try {
        expect(() =>
          wrongKeyService.decrypt(encryptedValue, nonce),
        ).toThrow(DecryptionError);
      } finally {
        rmSync(wrongKeyDir, { recursive: true, force: true });
      }
    });

    it('if AAD is used, a ciphertext bound to one provider fails to decrypt under another', () => {
      const plaintext = 'sk-ant-openai-bound-key-secret';
      const provider1 = 'prov_openai_01';
      const provider2 = 'prov_anthropic_02';

      // Encrypt bound to provider1
      const { encryptedValue, nonce } = service.encrypt(plaintext, provider1);

      // Decrypt with correct provider1 succeeds
      expect(service.decrypt(encryptedValue, nonce, provider1)).toBe(plaintext);

      // Decrypt under provider2 throws DecryptionError
      expect(() =>
        service.decrypt(encryptedValue, nonce, provider2),
      ).toThrow(DecryptionError);

      // Decrypt without AAD throws DecryptionError
      expect(() => service.decrypt(encryptedValue, nonce)).toThrow(
        DecryptionError,
      );

      // Conversely, encrypted without AAD cannot decrypt with AAD
      const unauthenticatedData = service.encrypt(plaintext);
      expect(() =>
        service.decrypt(
          unauthenticatedData.encryptedValue,
          unauthenticatedData.nonce,
          provider1,
        ),
      ).toThrow(DecryptionError);
    });

    it('asserts plaintext is absent from a thrown error message', () => {
      const highEntropySecret = 'CANARY_SECRET_sk-ant-sensitive-payload-987654321';
      const { encryptedValue, nonce } = service.encrypt(highEntropySecret);

      // Corrupt payload to force DecryptionError
      const corrupted = Buffer.from(encryptedValue);
      corrupted[2] ^= 0xff;

      let caughtError: unknown;
      try {
        service.decrypt(corrupted, nonce);
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(DecryptionError);
      const errorMessage = (caughtError as Error).message;

      expect(errorMessage).not.toContain(highEntropySecret);
      expect(errorMessage).not.toContain('CANARY');
      expect(errorMessage).not.toContain('sk-ant');
      expect(errorMessage).not.toContain('987654321');
    });
  });

  describe('Database Round-Trip BLOB Integrity', () => {
    it('round-trips binary BLOB values in SQLite without corruption and decrypts accurately', () => {
      const dbService = new DatabaseService();
      dbService.connect(':memory:');
      try {
        dbService.run(
          `INSERT INTO providers (id, name, kind, is_local, enabled, created_at, updated_at)
           VALUES ('prov_test_gcm', 'Test Provider', 'openai', 0, 1, '2026-01-01', '2026-01-01')`,
        );

        const plaintext = 'sk-proj-database-roundtrip-verified-key-12345';
        const masked = service.maskKey(plaintext);
        const { encryptedValue, nonce } = service.encrypt(plaintext, 'prov_test_gcm');

        dbService.run(
          `INSERT INTO provider_credentials (provider_id, encrypted_value, nonce, masked_preview, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          ['prov_test_gcm', encryptedValue, nonce, masked, '2026-01-01', '2026-01-01'],
        );

        const record = dbService.get<{
          provider_id: string;
          encrypted_value: Buffer;
          nonce: Buffer;
          masked_preview: string;
        }>('SELECT * FROM provider_credentials WHERE provider_id = ?', ['prov_test_gcm']);

        expect(record).toBeDefined();
        expect(Buffer.isBuffer(record!.encrypted_value)).toBe(true);
        expect(Buffer.isBuffer(record!.nonce)).toBe(true);
        expect(record!.masked_preview).toBe('sk-proj-…2345');

        // Verify that the read Buffer decrypts cleanly
        const decrypted = service.decrypt(
          record!.encrypted_value,
          record!.nonce,
          record!.provider_id,
        );
        expect(decrypted).toBe(plaintext);
      } finally {
        dbService.close();
      }
    });
  });
});
