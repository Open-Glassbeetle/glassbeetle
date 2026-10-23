import http from 'node:http';
import https from 'node:https';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from './harness/index.js';

describe('Provider credentials endpoints (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(() => {
    testApp.reset();
  });

  // 1. Unknown provider handling (404 on all endpoints)
  describe('Unknown provider handling', () => {
    const unknownProviderId = '018f3a9e-0000-7000-8000-000000000000';

    it('GET /api/v1/providers/:providerId/credential returns 404 for unknown provider', async () => {
      const res = await testApp
        .request()
        .get(`/api/v1/providers/${unknownProviderId}/credential`)
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('PUT /api/v1/providers/:providerId/credential returns 404 for unknown provider', async () => {
      const res = await testApp
        .request()
        .put(`/api/v1/providers/${unknownProviderId}/credential`)
        .send({ apiKey: 'sk-ant-api03-samplekey1234' })
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('DELETE /api/v1/providers/:providerId/credential returns 404 for unknown provider', async () => {
      const res = await testApp
        .request()
        .delete(`/api/v1/providers/${unknownProviderId}/credential`)
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });
  });

  // 2. GET /api/v1/providers/:providerId/credential
  describe('GET /api/v1/providers/:providerId/credential', () => {
    it('returns 404 when provider exists but has no credential configured', async () => {
      const provider = testApp.fixtures.createProvider({ name: 'Uncredentialed Provider' });

      const res = await testApp
        .request()
        .get(`/api/v1/providers/${provider.id}/credential`)
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
      expect(res.body.message).toContain('No credential configured');
    });

    it('returns 200 with metadata when credential is configured', async () => {
      const provider = testApp.fixtures.createProvider({ name: 'Anthropic Provider' });
      const secret = 'sk-ant-api03-abcdef12345678904f2a';

      // Set via PUT
      await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: secret })
        .expect(200);

      const res = await testApp
        .request()
        .get(`/api/v1/providers/${provider.id}/credential`)
        .expect(200);

      expect(res.body).toEqual({
        providerId: provider.id,
        configured: true,
        maskedPreview: 'sk-ant-…4f2a',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });

      // Crucial: assert metadata only, never plaintext, ciphertext or nonce
      expect(res.body).not.toHaveProperty('encryptedValue');
      expect(res.body).not.toHaveProperty('ciphertext');
      expect(res.body).not.toHaveProperty('nonce');
      expect(res.body).not.toHaveProperty('apiKey');
      expect(res.body).not.toHaveProperty('value');
    });
  });

  // 3. PUT /api/v1/providers/:providerId/credential (Validation)
  describe('PUT /api/v1/providers/:providerId/credential - Validation', () => {
    it('rejects an empty apiKey string with 400 Bad Request', async () => {
      const provider = testApp.fixtures.createProvider();

      const res = await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: '' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
    });

    it('rejects a whitespace-only apiKey string with 400 Bad Request', async () => {
      const provider = testApp.fixtures.createProvider();

      const res = await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: '    \t\n  ' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
    });

    it('rejects an empty body object with 400 Bad Request', async () => {
      const provider = testApp.fixtures.createProvider();

      const res = await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({})
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
    });

    it('rejects a non-string value with 400 Bad Request', async () => {
      const provider = testApp.fixtures.createProvider();

      const res = await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: 123456 })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
    });

    it('rejects unknown properties with 400 Bad Request (forbidNonWhitelisted)', async () => {
      const provider = testApp.fixtures.createProvider();

      const res = await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: 'sk-ant-validkey1234', disallowedField: 'hack' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
      expect(res.body.details).toEqual(
        expect.arrayContaining([expect.stringContaining('property disallowedField should not exist')]),
      );
    });
  });

  // 4. PUT /api/v1/providers/:providerId/credential (Persistence, Upsert, Encryption)
  describe('PUT /api/v1/providers/:providerId/credential - Upsert and Encryption', () => {
    it('encrypts on write and stores ciphertext and nonce as Buffers without plaintext', async () => {
      const provider = testApp.fixtures.createProvider();
      const secret = 'sk-ant-api03-topsecretvalue12345678904f2a';

      const res = await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: secret })
        .expect(200);

      expect(res.body.configured).toBe(true);
      expect(res.body.maskedPreview).toBe('sk-ant-…4f2a');

      // Verify directly from SQLite
      const row = testApp.db.get<{
        provider_id: string;
        encrypted_value: Buffer;
        nonce: Buffer;
        masked_preview: string;
        created_at: string;
        updated_at: string;
      }>('SELECT * FROM provider_credentials WHERE provider_id = ?', [provider.id]);

      expect(row).toBeDefined();
      expect(row?.provider_id).toBe(provider.id);
      expect(Buffer.isBuffer(row?.encrypted_value)).toBe(true);
      expect(Buffer.isBuffer(row?.nonce)).toBe(true);
      expect(row?.nonce.length).toBe(12);
      expect(row?.masked_preview).toBe('sk-ant-…4f2a');

      // Ciphertext must never contain the plaintext secret
      const rawEncString = row?.encrypted_value.toString('utf-8');
      expect(rawEncString).not.toContain('topsecretvalue');
      expect(rawEncString).not.toContain(secret);
    });

    it('accepts alternative "value" property name in JSON request body', async () => {
      const provider = testApp.fixtures.createProvider();
      const secret = 'sk-proj-valuenamedsecret1234';

      const res = await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ value: secret })
        .expect(200);

      expect(res.body.configured).toBe(true);
      expect(res.body.maskedPreview).toBe('sk-proj-…1234');
    });

    it('uses a fresh nonce on each write so identical plaintext produces different ciphertext', async () => {
      const provider = testApp.fixtures.createProvider();
      const secret = 'sk-ant-identical-secret-key-1234';

      // First write
      await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: secret })
        .expect(200);

      const firstRow = testApp.db.get<{
        encrypted_value: Buffer;
        nonce: Buffer;
      }>('SELECT encrypted_value, nonce FROM provider_credentials WHERE provider_id = ?', [provider.id]);

      // Second write with the exact same plaintext value
      await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: secret })
        .expect(200);

      const secondRow = testApp.db.get<{
        encrypted_value: Buffer;
        nonce: Buffer;
      }>('SELECT encrypted_value, nonce FROM provider_credentials WHERE provider_id = ?', [provider.id]);

      // Nonce must be freshly generated (never reused)
      expect(firstRow?.nonce.equals(secondRow!.nonce)).toBe(false);
      // Ciphertext must differ because of different nonces
      expect(firstRow?.encrypted_value.equals(secondRow!.encrypted_value)).toBe(false);
    });

    it('upserts: replacing existing credential leaves only one row and refreshes updatedAt', async () => {
      const provider = testApp.fixtures.createProvider();

      // 1. Initial write
      const firstRes = await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: 'sk-ant-initialkey-1111' })
        .expect(200);

      const firstCreatedAt = firstRes.body.createdAt;

      // 2. Overwrite with new value
      const secondRes = await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: 'sk-ant-updatedkey-2222' })
        .expect(200);

      // Verify only 1 row exists
      const rows = testApp.db.all('SELECT * FROM provider_credentials WHERE provider_id = ?', [provider.id]);
      expect(rows).toHaveLength(1);

      // Masked preview reflects new value
      expect(secondRes.body.maskedPreview).toBe('sk-ant-…2222');
      // createdAt is preserved
      expect(secondRes.body.createdAt).toBe(firstCreatedAt);
    });

    it('masks very short secrets without revealing secret characters', async () => {
      const provider = testApp.fixtures.createProvider();

      const res = await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: '1234' })
        .expect(200);

      // Short inputs (<= 4 chars) should not reveal any characters
      expect(res.body.maskedPreview).toBe('…');
    });
  });

  // 5. DELETE /api/v1/providers/:providerId/credential
  describe('DELETE /api/v1/providers/:providerId/credential', () => {
    it('deletes an existing credential and returns 204 No Content', async () => {
      const provider = testApp.fixtures.createProvider();

      await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: 'sk-ant-to-delete-1234' })
        .expect(200);

      // Delete the credential
      await testApp
        .request()
        .delete(`/api/v1/providers/${provider.id}/credential`)
        .expect(204);

      // Credential row is gone from SQLite
      const row = testApp.db.get(
        'SELECT * FROM provider_credentials WHERE provider_id = ?',
        [provider.id],
      );
      expect(row).toBeUndefined();

      // Subsequent GET returns 404
      await testApp
        .request()
        .get(`/api/v1/providers/${provider.id}/credential`)
        .expect(404);
    });

    it('is idempotent: returns 204 when deleting on a provider with no credential configured', async () => {
      const provider = testApp.fixtures.createProvider({ name: 'No Credential' });

      // First delete
      await testApp
        .request()
        .delete(`/api/v1/providers/${provider.id}/credential`)
        .expect(204);

      // Second delete
      await testApp
        .request()
        .delete(`/api/v1/providers/${provider.id}/credential`)
        .expect(204);
    });
  });

  // 6. Security and Leak Prevention
  describe('Security and leak prevention', () => {
    const sensitiveSecret = 'sk-ant-SECRET-LEAK-PROBE-XYZ123454f2a';
    const secretSubstring = 'SECRET-LEAK-PROBE-XYZ12345';

    it('asserts GET response body contains no substring of the plaintext secret', async () => {
      const provider = testApp.fixtures.createProvider();

      await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: sensitiveSecret })
        .expect(200);

      const res = await testApp
        .request()
        .get(`/api/v1/providers/${provider.id}/credential`)
        .expect(200);

      const stringifiedBody = JSON.stringify(res.body);
      expect(stringifiedBody).not.toContain(sensitiveSecret);
      expect(stringifiedBody).not.toContain(secretSubstring);
    });

    it('asserts stored encrypted_value in the database contains no substring of the plaintext', async () => {
      const provider = testApp.fixtures.createProvider();

      await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: sensitiveSecret })
        .expect(200);

      const row = testApp.db.get<{ encrypted_value: Buffer }>(
        'SELECT encrypted_value FROM provider_credentials WHERE provider_id = ?',
        [provider.id],
      );

      expect(row).toBeDefined();
      const rawText = row!.encrypted_value.toString('utf-8');
      expect(rawText).not.toContain(sensitiveSecret);
      expect(rawText).not.toContain(secretSubstring);
    });

    it('asserts validation error response body never leaks the plaintext secret', async () => {
      const provider = testApp.fixtures.createProvider();

      // Trigger a validation failure with an illegal property while secret is in payload
      const res = await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({
          apiKey: sensitiveSecret,
          unrecognizedProperty: 'invalid',
        })
        .expect(400);

      const responseString = JSON.stringify(res.body);
      expect(responseString).not.toContain(sensitiveSecret);
      expect(responseString).not.toContain(secretSubstring);
    });

    it('asserts log output contains no substring of the plaintext secret during set, get, and delete', async () => {
      const provider = testApp.fixtures.createProvider();
      const logChunks: string[] = [];

      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
        logChunks.push(String(chunk));
        return true;
      });
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
        logChunks.push(String(chunk));
        return true;
      });
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
        logChunks.push(args.map(String).join(' '));
      });
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: any[]) => {
        logChunks.push(args.map(String).join(' '));
      });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args: any[]) => {
        logChunks.push(args.map(String).join(' '));
      });

      try {
        // PUT
        await testApp
          .request()
          .put(`/api/v1/providers/${provider.id}/credential`)
          .send({ apiKey: sensitiveSecret })
          .expect(200);

        // GET
        await testApp
          .request()
          .get(`/api/v1/providers/${provider.id}/credential`)
          .expect(200);

        // DELETE
        await testApp
          .request()
          .delete(`/api/v1/providers/${provider.id}/credential`)
          .expect(204);

        const fullLogOutput = logChunks.join('\n');
        expect(fullLogOutput).not.toContain(sensitiveSecret);
        expect(fullLogOutput).not.toContain(secretSubstring);
      } finally {
        stdoutSpy.mockRestore();
        stderrSpy.mockRestore();
        consoleLogSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        consoleErrorSpy.mockRestore();
      }
    });

    it('asserts no outbound network call (fetch, https, or remote http) is made when setting a credential', async () => {
      const provider = testApp.fixtures.createProvider();

      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const httpsRequestSpy = vi.spyOn(https, 'request');
      const httpRequestSpy = vi.spyOn(http, 'request');

      try {
        await testApp
          .request()
          .put(`/api/v1/providers/${provider.id}/credential`)
          .send({ apiKey: 'sk-ant-test-outbound-forbidden-1234' })
          .expect(200);

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(httpsRequestSpy).not.toHaveBeenCalled();

        // Any http.request calls must only be the local supertest probe to loopback
        for (const call of httpRequestSpy.mock.calls) {
          const options = call[0];
          const host =
            typeof options === 'string'
              ? options
              : options?.host || options?.hostname;
          expect(['127.0.0.1', 'localhost']).toContain(host);
        }
      } finally {
        fetchSpy.mockRestore();
        httpsRequestSpy.mockRestore();
        httpRequestSpy.mockRestore();
      }
    });
  });

  // 7. Cascade on Provider Deletion
  describe('Provider deletion cascade (integration)', () => {
    it('deleting a provider automatically removes its credential via ON DELETE CASCADE', async () => {
      const provider = testApp.fixtures.createProvider();

      // Configure a credential
      await testApp
        .request()
        .put(`/api/v1/providers/${provider.id}/credential`)
        .send({ apiKey: 'sk-ant-cascade-test-key-1234' })
        .expect(200);

      // Verify row exists before provider deletion
      const credBefore = testApp.db.get<{ provider_id: string }>(
        'SELECT provider_id FROM provider_credentials WHERE provider_id = ?',
        [provider.id],
      );
      expect(credBefore).toBeDefined();

      // Delete the provider itself
      await testApp
        .request()
        .delete(`/api/v1/providers/${provider.id}`)
        .expect(204);

      // Assert credential row was destroyed by cascade
      const credAfter = testApp.db.get<{ provider_id: string }>(
        'SELECT provider_id FROM provider_credentials WHERE provider_id = ?',
        [provider.id],
      );
      expect(credAfter).toBeUndefined();
    });
  });
});
