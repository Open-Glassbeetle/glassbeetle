import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JSON_BODY_LIMIT_BYTES } from '../src/bootstrap.js';
import { createTestApp, type TestApp } from './harness/index.js';

/**
 * The memory DTOs allow 100 000 characters of content. In UTF-8 that is up to
 * four bytes per character, so the JSON body limit has to sit above 400 kB for
 * the documented limit to be reachable outside plain ASCII (issue #157).
 */
const MAX_CONTENT_CHARACTERS = 100_000;

describe('Memory request body size (e2e)', () => {
  let testApp: TestApp;
  let agentId: string;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(() => {
    testApp.reset();
    agentId = testApp.fixtures.createAgent({ name: 'Body Limit Agent' }).id;
  });

  /**
   * Each memory endpoint that accepts content, with the request that writes it.
   * Updates target a memory created up front, so all four DTOs are exercised.
   */
  const endpoints: ReadonlyArray<{
    name: string;
    send: (content: string) => Promise<import('supertest').Response>;
    readBack: (id: string) => string;
  }> = [
    {
      name: 'create shared memory',
      send: (content) =>
        testApp.request().post('/api/v1/memories').send({ content }),
      readBack: (id) => `/api/v1/memories/${id}`,
    },
    {
      name: 'update shared memory',
      send: async (content) => {
        const created = await testApp
          .request()
          .post('/api/v1/memories')
          .send({ content: 'seed' })
          .expect(201);

        return testApp
          .request()
          .patch(`/api/v1/memories/${created.body.id}`)
          .send({ content });
      },
      readBack: (id) => `/api/v1/memories/${id}`,
    },
    {
      name: 'create agent memory',
      send: (content) =>
        testApp
          .request()
          .post(`/api/v1/agents/${agentId}/memories`)
          .send({ content }),
      readBack: (id) => `/api/v1/agents/${agentId}/memories/${id}`,
    },
    {
      name: 'update agent memory',
      send: async (content) => {
        const created = await testApp
          .request()
          .post(`/api/v1/agents/${agentId}/memories`)
          .send({ content: 'seed' })
          .expect(201);

        return testApp
          .request()
          .patch(`/api/v1/agents/${agentId}/memories/${created.body.id}`)
          .send({ content });
      },
      readBack: (id) => `/api/v1/agents/${agentId}/memories/${id}`,
    },
  ];

  describe.each(endpoints)('$name', ({ send, readBack }) => {
    it('accepts 100 000 four-byte characters and reads them back intact', async () => {
      // U+1F41E LADY BEETLE: 4 bytes in UTF-8, counted as one character.
      const content = '\u{1F41E}'.repeat(MAX_CONTENT_CHARACTERS);
      expect(Buffer.byteLength(content, 'utf8')).toBe(400_000);

      const res = await send(content);
      expect(res.status).toBeLessThan(300);

      const read = await testApp
        .request()
        .get(readBack(res.body.id))
        .expect(200);
      expect(read.body.content).toBe(content);
    });

    it('accepts 100 000 CJK characters and reads them back intact', async () => {
      const content = '甲'.repeat(MAX_CONTENT_CHARACTERS);

      const res = await send(content);
      expect(res.status).toBeLessThan(300);

      const read = await testApp
        .request()
        .get(readBack(res.body.id))
        .expect(200);
      expect(Buffer.from(read.body.content, 'utf8')).toEqual(
        Buffer.from(content, 'utf8'),
      );
    });

    it('still rejects content over 100 000 characters with the validation message', async () => {
      const res = await send('ä'.repeat(MAX_CONTENT_CHARACTERS + 1));

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('BAD_REQUEST');
      expect(res.body.details).toContain(
        'content must not exceed 100000 characters',
      );
    });

    it('rejects a body over the limit with 413 and the error envelope', async () => {
      const res = await send('a'.repeat(JSON_BODY_LIMIT_BYTES + 1));

      expect(res.status).toBe(413);
      expect(res.body).toMatchObject({
        statusCode: 413,
        error: 'Payload Too Large',
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body is too large',
      });
      expect(typeof res.body.path).toBe('string');
      expect(typeof res.body.timestamp).toBe('string');
    });
  });
});
