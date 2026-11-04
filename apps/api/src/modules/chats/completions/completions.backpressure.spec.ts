import type { Request, Response } from 'express';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../../../database/database.service.js';
import { TestFixtures } from '../../../../test/harness/fixtures.js';
import { AdapterFactoryService } from '../../../model-adapters/adapter-factory/adapter-factory.service.js';
import { TestDoubleAdapter } from '../../../model-adapters/test/test-double-adapter.js';
import { CredentialsService } from '../../providers/credentials/credentials.service.js';
import { InferenceService } from '../../inference/inference.service.js';
import { CompletionsController } from './completions.controller.js';

describe('CompletionsController disconnect while parked on backpressure', () => {
  const CONTENT = 'lorem ipsum '.repeat(100);

  let db: DatabaseService;
  let fixtures: TestFixtures;
  let controller: CompletionsController;

  beforeEach(() => {
    db = new DatabaseService();
    db.connect(':memory:');
    fixtures = new TestFixtures(db);

    const testDouble = new TestDoubleAdapter(
      { providerKind: 'openai' },
      {
        cannedResponse: { content: CONTENT },
        streamChunkSize: 100,
      },
    );

    const adapterFactory = new AdapterFactoryService();
    adapterFactory.register(
      [
        'anthropic',
        'openai',
        'google',
        'ollama',
        'lmstudio',
        'openai_compatible',
      ],
      () => testDouble,
    );

    const credentials = {
      getDecryptedCredential: vi.fn().mockReturnValue('sk-test-secret-key'),
    };

    const inferenceService = new InferenceService(
      db,
      adapterFactory,
      credentials as unknown as CredentialsService,
    );
    controller = new CompletionsController(inferenceService);
  });

  afterEach(() => {
    db.close();
  });

  it('finalises the assistant row with partial content instead of leaving it streaming', async () => {
    const provider = fixtures.createProvider({ kind: 'openai', enabled: 1 });
    const model = fixtures.createModel({
      provider_id: provider.id,
      model_identifier: 'gpt-4o',
      enabled: 1,
    });
    const agent = fixtures.createAgent({ model_id: model.id });
    const chat = fixtures.createChat({ agent_id: agent.id });

    const req = new EventEmitter() as unknown as Request;
    (req as any).headers = {};

    const res = new EventEmitter() as unknown as Response;
    (res as any).writableEnded = false;
    (res as any).destroyed = false;
    (res as any).status = vi.fn().mockReturnValue(res);
    (res as any).setHeader = vi.fn();
    (res as any).flushHeaders = vi.fn();
    // Let message_start and the first token through, then fill the buffer
    // and hang up without ever draining it
    let writes = 0;
    (res as any).write = vi.fn(() => {
      writes++;
      if (writes < 3) {
        return true;
      }
      setTimeout(() => {
        (res as any).destroyed = true;
        res.emit('close');
      }, 10);
      return false;
    });
    (res as any).end = vi.fn();

    let settled = false;
    const completion = controller
      .createCompletion(chat.id, { stream: true }, req, res)
      .then(() => {
        settled = true;
      });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(settled).toBe(true);
    await completion;

    const row = db.get<{ status: string; content: string }>(
      `SELECT status, content FROM messages WHERE chat_id = ? AND role = 'assistant'`,
      [chat.id],
    );
    expect(row).toBeDefined();
    expect(row!.status).toBe('complete');
    expect(row!.content.length).toBeGreaterThan(0);
    expect(row!.content.length).toBeLessThan(CONTENT.length);
  });
});
