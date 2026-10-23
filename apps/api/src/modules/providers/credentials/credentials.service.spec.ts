import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../database/database.service.js';
import { EncryptionService } from '../../../crypto/encryption/encryption.service.js';
import {
  CredentialsService,
  type ProviderCredentialRow,
} from './credentials.service.js';
import { newId } from '../../../common/persistence/identifiers.js';
import { nowIso } from '../../../common/persistence/timestamps.js';

describe('CredentialsService', () => {
  let service: CredentialsService;
  let db: DatabaseService;
  let encryptionService: EncryptionService;
  let providerId: string;

  beforeEach(async () => {
    db = new DatabaseService();
    db.onModuleInit();

    encryptionService = new EncryptionService(undefined, {
      masterKey: Buffer.alloc(32, 0x42),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialsService,
        { provide: DatabaseService, useValue: db },
        { provide: EncryptionService, useValue: encryptionService },
      ],
    }).compile();

    service = module.get<CredentialsService>(CredentialsService);

    // Create a provider to satisfy foreign-key constraint
    providerId = newId();
    const now = nowIso();
    db.run(
      `INSERT INTO providers (id, name, kind, is_local, base_url, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [providerId, 'Test Provider', 'anthropic', 0, null, 1, now, now],
    );
  });

  describe('find', () => {
    it('throws NotFoundException when provider does not exist', () => {
      expect(() => service.find('non-existent-provider')).toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when provider exists but has no credential', () => {
      expect(() => service.find(providerId)).toThrow(NotFoundException);
    });

    it('returns credential metadata when credential exists', () => {
      service.set(providerId, { apiKey: 'sk-ant-api03-verylongsecretkey1234' });

      const metadata = service.find(providerId);

      expect(metadata).toEqual({
        providerId,
        configured: true,
        maskedPreview: 'sk-ant-…1234',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });

      // Assert no plaintext or sensitive properties are returned
      expect(metadata).not.toHaveProperty('encryptedValue');
      expect(metadata).not.toHaveProperty('ciphertext');
      expect(metadata).not.toHaveProperty('nonce');
      expect(metadata).not.toHaveProperty('apiKey');
    });
  });

  describe('set', () => {
    it('throws NotFoundException when provider does not exist', () => {
      expect(() =>
        service.set('unknown-provider', { apiKey: 'sk-12345' }),
      ).toThrow(NotFoundException);
    });

    it('throws BadRequestException when secret is empty', () => {
      expect(() => service.set(providerId, { apiKey: '' })).toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when secret is whitespace-only', () => {
      expect(() => service.set(providerId, { apiKey: '   \t\n  ' })).toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when neither apiKey nor value is provided', () => {
      expect(() => service.set(providerId, {})).toThrow(BadRequestException);
    });

    it('stores encrypted value and nonce as Buffers with no plaintext at rest', () => {
      const secret = 'sk-ant-secret-api-key-9999';
      const result = service.set(providerId, { apiKey: secret });

      expect(result.configured).toBe(true);
      expect(result.maskedPreview).toBe('sk-ant-…9999');

      const row = db.get<ProviderCredentialRow>(
        'SELECT * FROM provider_credentials WHERE provider_id = ?',
        [providerId],
      );

      expect(row).toBeDefined();
      expect(Buffer.isBuffer(row?.encrypted_value)).toBe(true);
      expect(Buffer.isBuffer(row?.nonce)).toBe(true);
      expect(row?.nonce.length).toBe(12);

      // Ciphertext must not contain the plaintext secret
      const rawEncryptedString = row?.encrypted_value.toString('utf-8');
      expect(rawEncryptedString).not.toContain('secret-api-key');
      expect(rawEncryptedString).not.toContain(secret);
    });

    it('accepts alternative "value" property name in DTO', () => {
      const result = service.set(providerId, {
        value: 'sk-proj-alternatenamekey1234',
      });
      expect(result.configured).toBe(true);
      expect(result.maskedPreview).toBe('sk-proj-…1234');
    });

    it('generates a fresh nonce on each write and produces different ciphertext', () => {
      const secret = 'sk-ant-identical-secret-key-1234';

      service.set(providerId, { apiKey: secret });
      const firstRow = db.get<ProviderCredentialRow>(
        'SELECT * FROM provider_credentials WHERE provider_id = ?',
        [providerId],
      );

      service.set(providerId, { apiKey: secret });
      const secondRow = db.get<ProviderCredentialRow>(
        'SELECT * FROM provider_credentials WHERE provider_id = ?',
        [providerId],
      );

      expect(firstRow?.nonce.equals(secondRow!.nonce)).toBe(false);
      expect(firstRow?.encrypted_value.equals(secondRow!.encrypted_value)).toBe(
        false,
      );
    });

    it('upserts: overwrites existing record without creating duplicate rows', () => {
      service.set(providerId, { apiKey: 'sk-ant-first-key-1111' });
      const firstResult = service.find(providerId);

      service.set(providerId, { apiKey: 'sk-ant-second-key-2222' });
      const secondResult = service.find(providerId);

      const rows = db.all<ProviderCredentialRow>(
        'SELECT * FROM provider_credentials WHERE provider_id = ?',
        [providerId],
      );
      expect(rows).toHaveLength(1);

      expect(secondResult.maskedPreview).toBe('sk-ant-…2222');
      expect(secondResult.createdAt).toBe(firstResult.createdAt);
      expect(service.getDecryptedCredential(providerId)).toBe(
        'sk-ant-second-key-2222',
      );
    });

    it('handles short secrets safely without leaking most of the secret', () => {
      service.set(providerId, { apiKey: '1234' });
      const result = service.find(providerId);
      expect(result.maskedPreview).toBe('…');
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when parent provider does not exist', () => {
      expect(() => service.remove('non-existent-provider')).toThrow(
        NotFoundException,
      );
    });

    it('is idempotent: returns successfully when provider exists but has no credential', () => {
      expect(() => service.remove(providerId)).not.toThrow();
    });

    it('deletes an existing credential row', () => {
      service.set(providerId, { apiKey: 'sk-ant-key-to-delete-1234' });
      expect(service.find(providerId)).toBeDefined();

      service.remove(providerId);

      expect(() => service.find(providerId)).toThrow(NotFoundException);
      const row = db.get(
        'SELECT * FROM provider_credentials WHERE provider_id = ?',
        [providerId],
      );
      expect(row).toBeUndefined();
    });
  });

  describe('getDecryptedCredential', () => {
    it('decrypts the stored ciphertext back to original plaintext', () => {
      const secret = 'sk-ant-decryption-test-key-5678';
      service.set(providerId, { apiKey: secret });

      const decrypted = service.getDecryptedCredential(providerId);
      expect(decrypted).toBe(secret);
    });

    it('throws NotFoundException when no credential exists', () => {
      expect(() => service.getDecryptedCredential(providerId)).toThrow(
        NotFoundException,
      );
    });
  });
});
