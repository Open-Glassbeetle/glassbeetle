import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ContextLengthExceededError,
  InvalidRequestError,
  ModelNotFoundError,
  ProviderUnavailableError,
  RateLimitError,
  RequestAbortedError,
} from '../errors/model-adapter-error.js';
import { AdapterFactoryService } from '../adapter-factory/adapter-factory.service.js';
import type { AdapterConfig } from '../types/index.js';
import {
  OllamaAdapter,
  OLLAMA_DEFAULT_BASE_URL,
  OLLAMA_DEFAULT_CONNECT_TIMEOUT_MS,
  OLLAMA_DEFAULT_GENERATION_TIMEOUT_MS,
  OLLAMA_DEFAULT_MODEL,
} from './ollama.adapter.js';
import type {
  OllamaChatResponse,
  OllamaTagsResponse,
} from './ollama.types.js';

describe('OllamaAdapter', () => {
  const defaultOllamaConfig: AdapterConfig = {
    providerId: '018f3a9e-0000-7000-8000-000000000004',
    providerKind: 'ollama',
    baseUrl: 'http://localhost:11434',
    modelIdentifier: 'qwen2.5:14b',
  };

  const sampleSuccessResponse: OllamaChatResponse = {
    model: 'qwen2.5:14b',
    created_at: '2026-10-29T08:00:00Z',
    message: {
      role: 'assistant',
      content: 'The sky is blue due to Rayleigh scattering.',
    },
    done_reason: 'stop',
    done: true,
    total_duration: 1200000000,
    load_duration: 100000000,
    prompt_eval_count: 24,
    eval_count: 150,
  };

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Capabilities & Configuration', () => {
    it('declares correct runtime capabilities and default timeouts', () => {
      const adapter = new OllamaAdapter(defaultOllamaConfig);
      expect(adapter.capabilities.supportsStreaming).toBe(true);
      expect(adapter.capabilities.supportsDiscovery).toBe(true);
      expect(adapter.capabilities.supportsSystemPrompt).toBe(true);
      expect(adapter.capabilities.supportsToolCalls).toBe(false);
      expect((adapter as any).connectTimeoutMs).toBe(OLLAMA_DEFAULT_CONNECT_TIMEOUT_MS);
      expect((adapter as any).generationTimeoutMs).toBe(OLLAMA_DEFAULT_GENERATION_TIMEOUT_MS);
    });

    it('defaults base URL to http://localhost:11434 if omitted or empty', async () => {
      const adapter = new OllamaAdapter({
        ...defaultOllamaConfig,
        baseUrl: null,
      });

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );

      await adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${OLLAMA_DEFAULT_BASE_URL}/api/chat`);
    });

    it('honours custom baseUrl and trims trailing slashes', async () => {
      const adapter = new OllamaAdapter({
        ...defaultOllamaConfig,
        baseUrl: 'http://192.168.1.50:11434///',
      });

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );

      await adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] });

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://192.168.1.50:11434/api/chat');
    });

    it('falls back to OLLAMA_DEFAULT_MODEL when modelIdentifier is undefined', () => {
      const adapter = new OllamaAdapter({
        providerId: '018f3a9e-0000-7000-8000-000000000004',
        providerKind: 'ollama',
      });
      const payload = adapter.buildChatPayload(
        { messages: [{ role: 'user', content: 'Hi' }] },
        false,
      );
      expect(payload.model).toBe(OLLAMA_DEFAULT_MODEL);
      expect((adapter as any).defaultModel).toBe(OLLAMA_DEFAULT_MODEL);
    });

    it('preserves model tag exactly as specified without normalisation', async () => {
      const adapter = new OllamaAdapter(defaultOllamaConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );

      await adapter.complete({
        model: 'deepseek-r1:32b-q4_K_M',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const parsedBody = JSON.parse(init.body as string);
      expect(parsedBody.model).toBe('deepseek-r1:32b-q4_K_M');
    });
  });

  describe('Zero Authentication Dependency', () => {
    it('operates with no credentials without warnings or errors', async () => {
      const adapter = new OllamaAdapter({
        providerId: '018f3a9e-0000-7000-8000-000000000004',
        providerKind: 'ollama',
        baseUrl: 'http://localhost:11434',
      });

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );

      await adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('forwards Authorization header if an API key is provided for authenticated proxy', async () => {
      const adapter = new OllamaAdapter({
        ...defaultOllamaConfig,
        apiKey: 'proxy-token-secret-12345',
      });

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );

      await adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer proxy-token-secret-12345');
    });
  });

  describe('Payload Building & System Prompt Placement', () => {
    it('prepends request.systemPrompt as a system message in the messages array', () => {
      const adapter = new OllamaAdapter(defaultOllamaConfig);
      const payload = adapter.buildChatPayload(
        {
          systemPrompt: 'You are an expert in local models.',
          messages: [{ role: 'user', content: 'Explain quantization.' }],
        },
        false,
      );

      expect(payload.messages).toEqual([
        { role: 'system', content: 'You are an expert in local models.' },
        { role: 'user', content: 'Explain quantization.' },
      ]);
    });

    it('maps temperature, maxTokens (num_predict) and passes modelParams opaquely into options', () => {
      const adapter = new OllamaAdapter(defaultOllamaConfig);
      const payload = adapter.buildChatPayload(
        {
          temperature: 0.8,
          maxTokens: 4096,
          modelParams: {
            top_p: 0.95,
            top_k: 50,
            seed: 42,
            stop: ['### User:'],
          },
          messages: [{ role: 'user', content: 'Hi' }],
        },
        false,
      );

      expect(payload.options).toEqual({
        temperature: 0.8,
        num_predict: 4096,
        top_p: 0.95,
        top_k: 50,
        seed: 42,
        stop: ['### User:'],
      });
    });

    it('omits options object when no parameters are specified', () => {
      const adapter = new OllamaAdapter(defaultOllamaConfig);
      const payload = adapter.buildChatPayload(
        { messages: [{ role: 'user', content: 'Hi' }] },
        false,
      );

      expect(payload.options).toBeUndefined();
    });
  });

  describe('Non-Streaming Completions', () => {
    it('returns normalised completion response including token usage, finishReason and model', async () => {
      const adapter = new OllamaAdapter(defaultOllamaConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );

      const response = await adapter.complete({
        messages: [{ role: 'user', content: 'Why is the sky blue?' }],
      });

      expect(response.content).toBe('The sky is blue due to Rayleigh scattering.');
      expect(response.finishReason).toBe('stop');
      expect(response.usage).toEqual({
        inputTokens: 24,
        outputTokens: 150,
        totalTokens: 174,
      });
      expect(response.model).toBe('qwen2.5:14b');
      expect(response.raw).toEqual(sampleSuccessResponse);
    });

    it('extracts reasoning content when thinking or reasoning_content is present', async () => {
      const adapter = new OllamaAdapter(defaultOllamaConfig);
      const reasoningResponse: OllamaChatResponse = {
        model: 'deepseek-r1:14b',
        message: {
          role: 'assistant',
          content: 'The answer is 42.',
          thinking: 'Let me compute the question first...',
        },
        done_reason: 'stop',
        done: true,
        prompt_eval_count: 10,
        eval_count: 20,
      };

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(reasoningResponse), { status: 200 }),
      );

      const response = await adapter.complete({
        messages: [{ role: 'user', content: 'Answer' }],
      });

      expect(response.content).toBe('The answer is 42.');
      expect(response.reasoningContent).toBe('Let me compute the question first...');
    });

    it('maps done_reason to normalised FinishReason', () => {
      const adapter = new OllamaAdapter(defaultOllamaConfig);
      expect(adapter.mapDoneReason('stop')).toBe('stop');
      expect(adapter.mapDoneReason('length')).toBe('length');
      expect(adapter.mapDoneReason('custom')).toBe('stop');
      expect(adapter.mapDoneReason(undefined)).toBe('stop');
    });
  });

  describe('Streaming NDJSON & Chunk Buffering', () => {
    it('consumes newline-delimited JSON stream and emits text-delta, usage, and complete events', async () => {
      const adapter = new OllamaAdapter(defaultOllamaConfig);

      const ndjsonLines = [
        JSON.stringify({
          model: 'qwen2.5:14b',
          message: { role: 'assistant', content: 'Local ' },
          done: false,
        }) + '\n',
        JSON.stringify({
          model: 'qwen2.5:14b',
          message: { role: 'assistant', content: 'AI ' },
          done: false,
        }) + '\n',
        JSON.stringify({
          model: 'qwen2.5:14b',
          message: { role: 'assistant', content: 'rocks!' },
          done_reason: 'stop',
          done: true,
          prompt_eval_count: 8,
          eval_count: 3,
        }) + '\n',
      ];

      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          for (const line of ndjsonLines) {
            controller.enqueue(encoder.encode(line));
          }
          controller.close();
        },
      });

      fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      const events = [];
      for await (const event of adapter.stream({
        messages: [{ role: 'user', content: 'Talk' }],
      })) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: 'text-delta', delta: 'Local ' },
        { type: 'text-delta', delta: 'AI ' },
        { type: 'text-delta', delta: 'rocks!' },
        {
          type: 'usage',
          usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 },
        },
        {
          type: 'complete',
          finishReason: 'stop',
          usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 },
          model: 'qwen2.5:14b',
        },
      ]);
    });

    it('correctly buffers and parses partial JSON lines split across multiple chunks', async () => {
      const adapter = new OllamaAdapter(defaultOllamaConfig);

      // A single line of JSON deliberately split across three distinct chunks
      const chunk1 = '{"model":"qwen2.5:14b","message":{"role":"assis';
      const chunk2 = 'tant","content":"Split across chunk boundary"},"done';
      const chunk3 = '":true,"done_reason":"stop","prompt_eval_count":5,"eval_count":4}\n';

      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(chunk1));
          controller.enqueue(encoder.encode(chunk2));
          controller.enqueue(encoder.encode(chunk3));
          controller.close();
        },
      });

      fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      const events = [];
      for await (const event of adapter.stream({
        messages: [{ role: 'user', content: 'Split test' }],
      })) {
        events.push(event);
      }

      expect(events).toHaveLength(3);
      expect(events[0]).toEqual({
        type: 'text-delta',
        delta: 'Split across chunk boundary',
      });
      expect(events[1]).toEqual({
        type: 'usage',
        usage: { inputTokens: 5, outputTokens: 4, totalTokens: 9 },
      });
      expect(events[2]).toEqual({
        type: 'complete',
        finishReason: 'stop',
        usage: { inputTokens: 5, outputTokens: 4, totalTokens: 9 },
        model: 'qwen2.5:14b',
      });
    });

    it('reports missing token counts as unknown (undefined) rather than zero', async () => {
      const adapter = new OllamaAdapter(defaultOllamaConfig);

      // Stream where terminating chunk omits prompt_eval_count and eval_count
      const ndjsonLines = [
        JSON.stringify({
          model: 'qwen2.5:14b',
          message: { role: 'assistant', content: 'No token counts reported.' },
          done: false,
        }) + '\n',
        JSON.stringify({
          model: 'qwen2.5:14b',
          done_reason: 'stop',
          done: true,
          // Notice: prompt_eval_count and eval_count are omitted
        }) + '\n',
      ];

      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          for (const line of ndjsonLines) {
            controller.enqueue(encoder.encode(line));
          }
          controller.close();
        },
      });

      fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      const events = [];
      for await (const event of adapter.stream({
        messages: [{ role: 'user', content: 'Test' }],
      })) {
        events.push(event);
      }

      // Assert NO usage event was emitted
      expect(events.some((e) => e.type === 'usage')).toBe(false);

      // Assert complete event reports usage as undefined (unknown), NOT zeros!
      const completeEvent = events.find((e) => e.type === 'complete');
      expect(completeEvent).toBeDefined();
      expect(completeEvent?.usage).toBeUndefined();
    });

    it('emits thought-delta events for thinking models during streaming', async () => {
      const adapter = new OllamaAdapter(defaultOllamaConfig);

      const ndjsonLines = [
        JSON.stringify({
          model: 'deepseek-r1:14b',
          message: { role: 'assistant', content: '', thinking: 'Analyzing query...' },
          done: false,
        }) + '\n',
        JSON.stringify({
          model: 'deepseek-r1:14b',
          message: { role: 'assistant', content: 'Result is 100.' },
          done_reason: 'stop',
          done: true,
        }) + '\n',
      ];

      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          for (const line of ndjsonLines) {
            controller.enqueue(encoder.encode(line));
          }
          controller.close();
        },
      });

      fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      const events = [];
      for await (const event of adapter.stream({
        messages: [{ role: 'user', content: 'Calculate' }],
      })) {
        events.push(event);
      }

      expect(events[0]).toEqual({
        type: 'thought-delta',
        delta: 'Analyzing query...',
      });
      expect(events[1]).toEqual({
        type: 'text-delta',
        delta: 'Result is 100.',
      });
    });

    it('aborts mid-stream cleanly and frees resources when cancellation signal fires', async () => {
      const adapter = new OllamaAdapter(defaultOllamaConfig);
      const abortController = new AbortController();

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({
                model: 'qwen2.5:14b',
                message: { role: 'assistant', content: 'Chunk 1' },
                done: false,
              }) + '\n',
            ),
          );
          abortController.abort();
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({
                model: 'qwen2.5:14b',
                message: { role: 'assistant', content: 'Chunk 2' },
                done: false,
              }) + '\n',
            ),
          );
          controller.close();
        },
      });

      fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      try {
        for await (const _ of adapter.stream(
          { messages: [{ role: 'user', content: 'Abort test' }] },
          { signal: abortController.signal },
        )) {
          // iterate
        }
        expect.unreachable('Should have thrown RequestAbortedError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(RequestAbortedError);
        expect((err as RequestAbortedError).code).toBe('REQUEST_ABORTED');
      }
    });
  });

  describe('Model Discovery', () => {
    it('discovers installed models via GET /api/tags, preserving tags and contextWindow', async () => {
      const adapter = new OllamaAdapter(defaultOllamaConfig);

      const discoveryResponse: OllamaTagsResponse = {
        models: [
          {
            name: 'qwen2.5:14b',
            model: 'qwen2.5:14b',
            modified_at: '2026-10-25T12:00:00Z',
            size: 9000000000,
            digest: 'sha256:111111',
            context_window: 32768,
            details: {
              format: 'gguf',
              family: 'qwen2',
              parameter_size: '14.8B',
            },
          },
          {
            name: 'llama3.2:3b',
            model: 'llama3.2:3b',
            modified_at: '2026-10-26T12:00:00Z',
            size: 2000000000,
            digest: 'sha256:222222',
          },
        ],
      };

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(discoveryResponse), { status: 200 }),
      );

      const models = await adapter.discoverModels();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:11434/api/tags');

      expect(models).toEqual([
        {
          modelIdentifier: 'qwen2.5:14b',
          displayName: 'qwen2.5:14b',
          contextWindow: 32768,
          defaultTemperature: null,
          defaultMaxTokens: null,
        },
        {
          modelIdentifier: 'llama3.2:3b',
          displayName: 'llama3.2:3b',
          contextWindow: null,
          defaultTemperature: null,
          defaultMaxTokens: null,
        },
      ]);
    });

    it('handles empty installed-model listing gracefully', async () => {
      const adapter = new OllamaAdapter(defaultOllamaConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ models: [] }), { status: 200 }),
      );

      const models = await adapter.discoverModels();
      expect(models).toEqual([]);
    });
  });

  describe('Timeout Separation: Connect vs Generation', () => {
    it('does not cut off a slow local model generation with the connection timeout', async () => {
      // Connect timeout is set to 20ms, but generation takes longer
      const adapter = new OllamaAdapter(defaultOllamaConfig, {
        connectTimeoutMs: 20,
        generationTimeoutMs: 10_000,
      });

      // Simulate connection headers arriving immediately
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          // Wait 50ms (longer than the 20ms connect timeout)
          await new Promise((resolve) => setTimeout(resolve, 50));
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                model: 'qwen2.5:14b',
                message: { role: 'assistant', content: 'Slow local generation completed' },
                done: true,
                done_reason: 'stop',
              }) + '\n',
            ),
          );
          controller.close();
        },
      });

      fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      const events = [];
      for await (const event of adapter.stream({
        messages: [{ role: 'user', content: 'Slow prompt' }],
      })) {
        events.push(event);
      }

      // Assert it succeeded without throwing connection timeout
      expect(events[0]).toEqual({
        type: 'text-delta',
        delta: 'Slow local generation completed',
      });
      expect(events[1].type).toBe('complete');
    });

    it('fails fast with actionable error when connection times out', async () => {
      const adapter = new OllamaAdapter(defaultOllamaConfig, {
        connectTimeoutMs: 25,
      });

      // Simulate connection hanging indefinitely
      fetchMock.mockImplementationOnce(
        (_url, init: RequestInit) =>
          new Promise((_, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(new Error('Connection timed out'));
            });
          }),
      );

      try {
        await adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] });
        expect.unreachable('Should have timed out connecting');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ProviderUnavailableError);
        const error = err as ProviderUnavailableError;
        expect(error.message).toContain('Ollama is not running at http://localhost:11434');
        expect(error.message).toContain('connection timed out');
      }
    });
  });

  describe('Actionable Local Error Mapping', () => {
    it('produces actionable error naming the server and URL when connection is refused (ECONNREFUSED)', async () => {
      const adapter = new OllamaAdapter(defaultOllamaConfig);
      const networkError = new TypeError('fetch failed');
      (networkError as any).cause = { code: 'ECONNREFUSED' };

      fetchMock.mockRejectedValueOnce(networkError);

      try {
        await adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] });
        expect.unreachable('Should have thrown ProviderUnavailableError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ProviderUnavailableError);
        const error = err as ProviderUnavailableError;
        expect(error.statusCode).toBe(503);
        expect(error.retryable).toBe(true);
        expect(error.message).toBe(
          'Ollama is not running at http://localhost:11434. Ensure Ollama is started with \'ollama serve\' or by opening the Ollama application.',
        );
      }
    });

    it('produces actionable error naming the model when model is not pulled (404)', async () => {
      const adapter = new OllamaAdapter(defaultOllamaConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "model 'qwen2.5:14b' not found, try pulling it first",
          }),
          { status: 404 },
        ),
      );

      try {
        await adapter.complete({
          model: 'qwen2.5:14b',
          messages: [{ role: 'user', content: 'Hi' }],
        });
        expect.unreachable('Should have thrown ModelNotFoundError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ModelNotFoundError);
        const error = err as ModelNotFoundError;
        expect(error.statusCode).toBe(404);
        expect(error.message).toContain('qwen2.5:14b');
      }
    });

    it('produces actionable error when model is still loading into memory', async () => {
      const adapter = new OllamaAdapter(defaultOllamaConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: 'loading model weights into memory, please wait',
          }),
          { status: 500 },
        ),
      );

      try {
        await adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] });
        expect.unreachable('Should have thrown ProviderUnavailableError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ProviderUnavailableError);
        const error = err as ProviderUnavailableError;
        expect(error.message).toContain('still loading into memory');
        expect(error.retryable).toBe(true);
      }
    });

    it('maps 400 to InvalidRequestError', async () => {
      const adapter = new OllamaAdapter(defaultOllamaConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: 'invalid request: format not supported' }),
          { status: 400 },
        ),
      );

      await expect(
        adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow(InvalidRequestError);
    });

    it('maps context length error to ContextLengthExceededError', async () => {
      const adapter = new OllamaAdapter(defaultOllamaConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: 'context length exceeded: 35000 tokens' }),
          { status: 400 },
        ),
      );

      await expect(
        adapter.complete({ messages: [{ role: 'user', content: 'Huge prompt' }] }),
      ).rejects.toThrow(ContextLengthExceededError);
    });

    it('maps 429 to RateLimitError', async () => {
      const adapter = new OllamaAdapter(defaultOllamaConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: 'rate limit reached on gateway' }),
          { status: 429 },
        ),
      );

      await expect(
        adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow(RateLimitError);
    });
  });

  describe('Credential Sanitization', () => {
    it('redacts secret credentials from error output if configured', async () => {
      const secret = 'super-secret-proxy-key-xyz';
      const adapter = new OllamaAdapter({
        ...defaultOllamaConfig,
        apiKey: secret,
      });

      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: `Rejected bearer token ${secret}` }),
          { status: 401 },
        ),
      );

      try {
        await adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] });
        expect.unreachable('Should have thrown error');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ProviderUnavailableError);
        const error = err as ProviderUnavailableError;
        expect(error.message).not.toContain(secret);
        expect(error.message).toContain('[REDACTED_API_KEY]');
      }
    });
  });

  describe('Factory Registration', () => {
    it('registers for kind "ollama" and constructs OllamaAdapter instance', () => {
      const factory = new AdapterFactoryService();
      factory.register('ollama', (config) => new OllamaAdapter(config));

      expect(factory.isSupported('ollama')).toBe(true);
      expect(factory.getSupportedKinds()).toContain('ollama');

      const adapter = factory.create({
        providerId: '018f3a9e-0000-7000-8000-000000000004',
        providerKind: 'ollama',
      });

      expect(adapter).toBeInstanceOf(OllamaAdapter);
      expect(adapter.capabilities.supportsStreaming).toBe(true);
    });
  });
});
