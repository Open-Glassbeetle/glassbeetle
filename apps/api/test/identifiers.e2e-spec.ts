import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness/index.js';

/**
 * Identifiers are validated at the edge (#242): a value that is not a UUIDv7
 * can never name a resource, so it answers 400 instead of reaching a lookup.
 */
describe('Identifier validation (e2e)', () => {
  let testApp: TestApp;

  /** Well-formed UUIDv7 that names nothing. */
  const MISSING_V7 = '018f3a9e-0000-7000-8000-000000000999';
  /** Well-formed UUIDv4: valid UUID, but never issued by this API. */
  const V4 = '550e8400-e29b-41d4-a716-446655440000';

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(() => {
    testApp.reset();
  });

  describe('path parameters', () => {
    const malformedPaths = (
      id: string,
      agentId: string,
    ): [string, string][] => [
      ['get', `/api/v1/agents/${id}`],
      ['patch', `/api/v1/agents/${id}`],
      ['delete', `/api/v1/agents/${id}`],
      ['get', `/api/v1/agents/${id}/picture`],
      ['delete', `/api/v1/agents/${id}/picture`],
      ['get', `/api/v1/agents/${id}/memories`],
      ['post', `/api/v1/agents/${id}/memories`],
      ['delete', `/api/v1/agents/${id}/memories?confirm=true`],
      ['get', `/api/v1/agents/${agentId}/memories/${id}`],
      ['patch', `/api/v1/agents/${agentId}/memories/${id}`],
      ['delete', `/api/v1/agents/${agentId}/memories/${id}`],
      ['get', `/api/v1/memories/${id}`],
      ['patch', `/api/v1/memories/${id}`],
      ['delete', `/api/v1/memories/${id}`],
    ];

    it.each([
      ['a non-UUID string', 'not-a-uuid'],
      ['a UUIDv4', V4],
    ])(
      'answers 400 INVALID_IDENTIFIER for %s on every endpoint',
      async (_label, id) => {
        const agent = testApp.fixtures.createAgent();

        for (const [method, path] of malformedPaths(id, agent.id)) {
          const req = testApp
            .request()
            [method as 'get' | 'post' | 'patch' | 'delete'](path);
          const res = await (method === 'post' || method === 'patch'
            ? req.send({ content: 'Fact' })
            : req);

          expect(res.status, `${method.toUpperCase()} ${path}`).toBe(400);
          expect(res.body.code, `${method.toUpperCase()} ${path}`).toBe(
            'INVALID_IDENTIFIER',
          );
          expect(res.body.message).not.toContain(id);
        }
      },
    );

    it('names the parameter in the message', async () => {
      const agent = testApp.fixtures.createAgent();

      const agentRes = await testApp
        .request()
        .get('/api/v1/agents/not-a-uuid')
        .expect(400);
      expect(agentRes.body.message).toBe('agentId must be a UUIDv7');

      const memoryRes = await testApp
        .request()
        .get(`/api/v1/agents/${agent.id}/memories/not-a-uuid`)
        .expect(400);
      expect(memoryRes.body.message).toBe('memoryId must be a UUIDv7');
    });

    it('does not echo an oversized or markup-bearing id back', async () => {
      for (const id of ['a'.repeat(4000), '<script>alert(1)</script>']) {
        const res = await testApp
          .request()
          .get(`/api/v1/agents/${encodeURIComponent(id)}`)
          .expect(400);

        expect(res.body.message).not.toContain(id);
        expect(res.body.message.length).toBeLessThan(64);
      }
    });

    it('still answers 404 for a well-formed id that names nothing', async () => {
      const res = await testApp
        .request()
        .get(`/api/v1/agents/${MISSING_V7}`)
        .expect(404);
      expect(res.body.code).toBe('AGENT_NOT_FOUND');

      const memRes = await testApp
        .request()
        .get(`/api/v1/memories/${MISSING_V7}`)
        .expect(404);
      expect(memRes.body.statusCode).toBe(404);
    });
  });

  describe('body fields', () => {
    it.each(['modelId', 'systemPromptId'])(
      'rejects a malformed %s on create and update with a field error',
      async (field) => {
        const created = await testApp
          .request()
          .post('/api/v1/agents')
          .send({ name: 'Agent', [field]: 'not-a-uuid' })
          .expect(400);
        expect(JSON.stringify(created.body.details)).toContain(
          `${field} must be a UUIDv7`,
        );

        const agent = testApp.fixtures.createAgent();
        const updated = await testApp
          .request()
          .patch(`/api/v1/agents/${agent.id}`)
          .send({ [field]: V4 })
          .expect(400);
        expect(JSON.stringify(updated.body.details)).toContain(
          `${field} must be a UUIDv7`,
        );
      },
    );

    it('still accepts null to unlink a model or template', async () => {
      const agent = testApp.fixtures.createAgent();

      await testApp
        .request()
        .patch(`/api/v1/agents/${agent.id}`)
        .send({ modelId: null, systemPromptId: null })
        .expect(200);
    });
  });

  describe('query filters', () => {
    it.each(['modelId', 'systemPromptId'])(
      'rejects a malformed %s filter',
      async (field) => {
        const res = await testApp
          .request()
          .get(`/api/v1/agents?${field}=not-a-uuid`)
          .expect(400);

        expect(res.body.details).toContain(
          `${field} must be a UUIDv7 or "null"`,
        );
      },
    );

    it.each(['modelId', 'systemPromptId'])(
      'keeps the literal "null" and a well-formed id valid for %s',
      async (field) => {
        await testApp.request().get(`/api/v1/agents?${field}=null`).expect(200);
        await testApp
          .request()
          .get(`/api/v1/agents?${field}=${MISSING_V7}`)
          .expect(200);
      },
    );
  });
});
