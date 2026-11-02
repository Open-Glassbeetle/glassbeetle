import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AuthenticationError,
  AuthorizationError,
  ModelNotFoundError,
  ProviderUnavailableError,
  RateLimitError,
  RequestAbortedError,
  RequestTimeoutError,
} from '../errors/model-adapter-error.js';
import { ExampleOpenAiCompatibleAdapter } from './worked-example-adapter.js';

const API_KEY = 'sk-test-123';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

async function withServer(handler: Handler): Promise<{ port: number; close: () => Promise<void> }> {
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function adapterFor(port: number, timeoutMs = 5_000) {
  return new ExampleOpenAiCompatibleAdapter(
    {
      providerId: 'p',
      providerKind: 'openai_compatible',
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: API_KEY,
      modelIdentifier: 'test-model',
    },
    { timeoutMs },
  );
}

const request = {
  messages: [{ role: 'user' as const, content: 'hi' }],
};

describe('ExampleOpenAiCompatibleAdapter executeFetch errors', () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (closers.length) {
      await closers.pop()!();
    }
  });

  async function serve(handler: Handler) {
    const s = await withServer(handler);
    closers.push(s.close);
    return s.port;
  }

  it.each([
    [401, AuthenticationError, 'AUTHENTICATION_FAILED'],
    [403, AuthorizationError, 'AUTHORIZATION_FAILED'],
    [404, ModelNotFoundError, 'MODEL_NOT_FOUND'],
    [429, RateLimitError, 'RATE_LIMIT_EXCEEDED'],
    [500, ProviderUnavailableError, 'PROVIDER_UNAVAILABLE'],
  ] as const)('maps HTTP %i to %s', async (status, ErrorClass, code) => {
    const port = await serve((_req, res) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `upstream ${status}` } }));
    });
    const adapter = adapterFor(port);
    await expect(adapter.complete(request)).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ErrorClass);
      expect(err).toMatchObject({ code });
      expect((err as Error).message).not.toContain(API_KEY);
      return true;
    });
  });

  it('maps discovery 401 to AuthenticationError', async () => {
    const port = await serve((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'nope' } }));
    });
    const adapter = adapterFor(port);
    await expect(adapter.discoverModels()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('times out a hanging connection as RequestTimeoutError', async () => {
    const port = await serve((_req, _res) => {
      // Accept and never write.
    });
    const adapter = adapterFor(port, 50);
    await expect(adapter.complete(request)).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(RequestTimeoutError);
      expect(err).not.toBeInstanceOf(RequestAbortedError);
      expect((err as Error).message).not.toContain(API_KEY);
      return true;
    });
  });

  it('surfaces AbortSignal cancellation as RequestAbortedError', async () => {
    const port = await serve((_req, _res) => {
      // Hang until the client aborts.
    });
    const adapter = adapterFor(port, 5_000);
    const controller = new AbortController();
    const pending = adapter.complete(request, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(RequestAbortedError);
  });

  it('surfaces connection refused as ProviderUnavailableError', async () => {
    const adapter = adapterFor(1);
    await expect(adapter.complete(request)).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ProviderUnavailableError);
      expect((err as Error).message).not.toContain(API_KEY);
      return true;
    });
  });
});
