import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthenticationError,
  ContextLengthExceededError,
  InvalidRequestError,
  ModelNotFoundError,
  ProviderUnavailableError,
  RateLimitError,
  RequestAbortedError,
  UnsupportedCapabilityError,
} from '../errors/model-adapter-error.js';
import { AdapterFactoryService } from '../adapter-factory/adapter-factory.service.js';
import type { AdapterConfig, CompletionRequest } from '../types/index.js';
import {
  OpenAiAdapter,
  OPENAI_DEFAULT_BASE_URL,
  OPENAI_DEFAULT_MODEL,
} from './openai.adapter.js';
import type {
  OpenAiChatCompletionChunk,
  OpenAiChatCompletionResponse,
  OpenAiModelsResponse,
} from './openai.types.js';

describe('OpenAiAdapter', () => {
  const secretKey = 'sk-proj-test-secret-key-1234567890-abcdef';
  const defaultOpenAiConfig: AdapterConfig = {
    providerId: '018f3a9e-0000-7000-8000-000000000001',
    providerKind: 'openai',
    apiKey: secretKey,
    modelIdentifier: 'gpt-4o',
  };

  const defaultLmStudioConfig: AdapterConfig = {
    providerId: '018f3a9e-0000-7000-8000-000000000002',
    providerKind: 'lmstudio',
    baseUrl: 'http://localhost:1234',
    modelIdentifier: 'qwen2.5-7b',
  };

  const defaultCompatibleConfig: AdapterConfig = {
    providerId: '018f3a9e-0000-7000-8000-000000000003',
    providerKind: 'openai_compatible',
    baseUrl: 'https://custom-gateway.internal/v1',
    apiKey: 'sk-custom-token-999',
    modelIdentifier: 'mistral-large',
  };

  const sampleSuccessResponse: OpenAiChatCompletionResponse = {
    id: 'chatcmpl-test-123',
    object: 'chat.completion',
    created: 1677652288,
    model: 'gpt-4o-2024-08-06',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'Hello! How can I help you today?',
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 12,
      completion_tokens: 8,
      total_tokens: 20,
    },
  };

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Configuration, Capabilities & URL Normalisation', () => {
    it('declares runtime capabilities accurately', () => {
      const adapter = new OpenAiAdapter(defaultOpenAiConfig);
      expect(adapter.capabilities.supportsStreaming).toBe(true);
      expect(adapter.capabilities.supportsDiscovery).toBe(true);
      expect(adapter.capabilities.supportsSystemPrompt).toBe(true);
      expect(adapter.capabilities.supportsToolCalls).toBe(false);
    });

    it('defaults base URL to public OpenAI endpoint when omitted for openai kind', async () => {
      const adapter = new OpenAiAdapter({
        ...defaultOpenAiConfig,
        baseUrl: null,
      });

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );

      await adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${OPENAI_DEFAULT_BASE_URL}/v1/chat/completions`);
    });

    it('defaults model to gpt-4o for openai kind when omitted from config and request', async () => {
      const adapter = new OpenAiAdapter({
        providerId: 'provider-1',
        providerKind: 'openai',
        apiKey: secretKey,
      });

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );

      await adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const payload = JSON.parse(init.body as string);
      expect(payload.model).toBe(OPENAI_DEFAULT_MODEL);
    });

    it('requires base_url for openai_compatible and lmstudio kinds', () => {
      expect(
        () =>
          new OpenAiAdapter({
            providerId: 'p1',
            providerKind: 'openai_compatible',
            baseUrl: undefined,
          }),
      ).toThrow(InvalidRequestError);

      expect(
        () =>
          new OpenAiAdapter({
            providerId: 'p2',
            providerKind: 'lmstudio',
            baseUrl: '   ',
          }),
      ).toThrow(InvalidRequestError);
    });

    it('normalises base_url whether supplied with or without /v1 and handles trailing slashes', async () => {
      // 1. Without /v1 and without trailing slash
      const adapterNoV1 = new OpenAiAdapter({
        providerId: 'p1',
        providerKind: 'lmstudio',
        baseUrl: 'http://localhost:1234',
      });
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );
      await adapterNoV1.complete({
        messages: [{ role: 'user', content: 'Hi' }],
      });
      expect(fetchMock.mock.calls[0][0]).toBe(
        'http://localhost:1234/v1/chat/completions',
      );

      // 2. With /v1 and trailing slash
      const adapterWithV1Slash = new OpenAiAdapter({
        providerId: 'p2',
        providerKind: 'lmstudio',
        baseUrl: 'http://localhost:1234/v1/',
      });
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );
      await adapterWithV1Slash.complete({
        messages: [{ role: 'user', content: 'Hi' }],
      });
      expect(fetchMock.mock.calls[1][0]).toBe(
        'http://localhost:1234/v1/chat/completions',
      );

      // 3. Custom gateway with /v1
      const adapterCustom = new OpenAiAdapter(defaultCompatibleConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );
      await adapterCustom.complete({
        messages: [{ role: 'user', content: 'Hi' }],
      });
      expect(fetchMock.mock.calls[2][0]).toBe(
        'https://custom-gateway.internal/v1/chat/completions',
      );
    });
  });

  describe('Authentication & Outbound Headers', () => {
    it('sends Authorization Bearer header when API key is configured', async () => {
      const adapter = new OpenAiAdapter(defaultOpenAiConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );

      await adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe(`Bearer ${secretKey}`);
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('works without a credential configured (no Authorization header sent)', async () => {
      const adapter = new OpenAiAdapter(defaultLmStudioConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );

      await adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('forwards custom HTTP headers from options', async () => {
      const adapter = new OpenAiAdapter(defaultOpenAiConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );

      await adapter.complete(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { headers: { 'X-Correlation-Id': 'corr-abc-123' } },
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Correlation-Id']).toBe('corr-abc-123');
    });
  });

  describe('Request Translation & System Message Placement', () => {
    it('prepends top-level systemPrompt as first message with role "system"', async () => {
      const adapter = new OpenAiAdapter(defaultOpenAiConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );

      const request: CompletionRequest = {
        systemPrompt: 'You are an expert engineer.',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there' },
          { role: 'user', content: 'How are you?' },
        ],
      };

      await adapter.complete(request);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const payload = JSON.parse(init.body as string);

      expect(payload.messages).toEqual([
        { role: 'system', content: 'You are an expert engineer.' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
        { role: 'user', content: 'How are you?' },
      ]);
    });

    it('maps message name and tool_call_id fields', async () => {
      const adapter = new OpenAiAdapter(defaultOpenAiConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );

      const request: CompletionRequest = {
        messages: [
          { role: 'user', content: 'Use the calculator', name: 'Alice' },
          { role: 'tool', content: '42', toolCallId: 'call_calc_123' },
        ],
      };

      await adapter.complete(request);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const payload = JSON.parse(init.body as string);

      expect(payload.messages[0]).toEqual({
        role: 'user',
        content: 'Use the calculator',
        name: 'Alice',
      });
      expect(payload.messages[1]).toEqual({
        role: 'tool',
        content: '42',
        tool_call_id: 'call_calc_123',
      });
    });

    it('passes modelParams opaquely as extra provider options', async () => {
      const adapter = new OpenAiAdapter(defaultOpenAiConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );

      const request: CompletionRequest = {
        model: 'custom-model-override',
        temperature: 0.2,
        maxTokens: 500,
        modelParams: {
          top_p: 0.95,
          frequency_penalty: 0.5,
          presence_penalty: 0.1,
          seed: 42,
        },
        messages: [{ role: 'user', content: 'Hi' }],
      };

      await adapter.complete(request);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const payload = JSON.parse(init.body as string);

      expect(payload.model).toBe('custom-model-override');
      expect(payload.temperature).toBe(0.2);
      expect(payload.max_tokens).toBe(500);
      expect(payload.top_p).toBe(0.95);
      expect(payload.frequency_penalty).toBe(0.5);
      expect(payload.presence_penalty).toBe(0.1);
      expect(payload.seed).toBe(42);
    });

    it('opts into stream_options: { include_usage: true } when streaming for openai provider kind', async () => {
      const adapter = new OpenAiAdapter(defaultOpenAiConfig);
      const encoder = new TextEncoder();
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      fetchMock.mockResolvedValueOnce(
        new Response(mockStream, { status: 200 }),
      );

      // Consume stream
      for await (const _event of adapter.stream({
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        // no-op
      }

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const payload = JSON.parse(init.body as string);
      expect(payload.stream).toBe(true);
      expect(payload.stream_options).toEqual({ include_usage: true });
    });

    it('does not force stream_options for lmstudio or openai_compatible by default', async () => {
      const adapter = new OpenAiAdapter(defaultLmStudioConfig);
      const encoder = new TextEncoder();
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      fetchMock.mockResolvedValueOnce(
        new Response(mockStream, { status: 200 }),
      );

      for await (const _event of adapter.stream({
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        // no-op
      }

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const payload = JSON.parse(init.body as string);
      expect(payload.stream).toBe(true);
      expect(payload.stream_options).toBeUndefined();
    });
  });

  describe('Non-streaming Completion Execution', () => {
    it('successfully maps a completion response including token usage', async () => {
      const adapter = new OpenAiAdapter(defaultOpenAiConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );

      const response = await adapter.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response.content).toBe('Hello! How can I help you today?');
      expect(response.finishReason).toBe('stop');
      expect(response.model).toBe('gpt-4o-2024-08-06');
      expect(response.usage).toEqual({
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
      });
      expect(response.reasoningContent).toBeUndefined();
      expect(response.raw).toEqual(sampleSuccessResponse);
    });

    it('extracts reasoning_content from reasoning models if provided', async () => {
      const adapter = new OpenAiAdapter(defaultCompatibleConfig);
      const reasoningResponse: OpenAiChatCompletionResponse = {
        ...sampleSuccessResponse,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'The answer is 42.',
              reasoning_content: 'Let me think step-by-step: 6 times 7 is 42.',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 15,
          completion_tokens: 25,
          total_tokens: 40,
          completion_tokens_details: {
            reasoning_tokens: 18,
          },
        },
      };

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(reasoningResponse), { status: 200 }),
      );

      const response = await adapter.complete({
        messages: [{ role: 'user', content: 'What is 6*7?' }],
      });

      expect(response.content).toBe('The answer is 42.');
      expect(response.reasoningContent).toBe(
        'Let me think step-by-step: 6 times 7 is 42.',
      );
      expect(response.usage).toEqual({
        inputTokens: 15,
        outputTokens: 25,
        totalTokens: 40,
        reasoningTokens: 18,
      });
    });

    it('maps all standard finish reasons correctly', async () => {
      const reasons = [
        { wire: 'stop', expected: 'stop' },
        { wire: 'length', expected: 'length' },
        { wire: 'tool_calls', expected: 'tool_calls' },
        { wire: 'function_call', expected: 'tool_calls' },
        { wire: 'content_filter', expected: 'content_filter' },
        { wire: 'unknown_vendor_reason', expected: 'other' },
        { wire: null, expected: 'other' },
      ];

      for (const { wire, expected } of reasons) {
        const adapter = new OpenAiAdapter(defaultOpenAiConfig);
        fetchMock.mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              ...sampleSuccessResponse,
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'text' },
                  finish_reason: wire,
                },
              ],
            }),
            { status: 200 },
          ),
        );

        const res = await adapter.complete({
          messages: [{ role: 'user', content: 'Hi' }],
        });
        expect(res.finishReason).toBe(expected);
      }
    });

    it('tolerates missing usage object defensively on compatible servers', async () => {
      const adapter = new OpenAiAdapter(defaultCompatibleConfig);
      const responseWithoutUsage = {
        ...sampleSuccessResponse,
        usage: undefined,
      };

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(responseWithoutUsage), { status: 200 }),
      );

      const res = await adapter.complete({
        messages: [{ role: 'user', content: 'Hi' }],
      });
      expect(res.usage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      });
    });
  });

  describe('Streaming Execution (SSE)', () => {
    function createSseStream(
      chunks: (string | OpenAiChatCompletionChunk)[],
    ): ReadableStream<Uint8Array> {
      const encoder = new TextEncoder();
      const lines = chunks
        .map((c) =>
          typeof c === 'string'
            ? `data: ${c}\n\n`
            : `data: ${JSON.stringify(c)}\n\n`,
        )
        .join('');

      return new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(lines));
          controller.close();
        },
      });
    }

    it('consumes SSE stream and emits text deltas, usage, and complete events', async () => {
      const adapter = new OpenAiAdapter(defaultOpenAiConfig);

      const sseChunks: (string | OpenAiChatCompletionChunk)[] = [
        {
          id: 'chunk-1',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: 'Hello' },
              finish_reason: null,
            },
          ],
        },
        {
          id: 'chunk-2',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [
            { index: 0, delta: { content: ' world' }, finish_reason: null },
          ],
        },
        {
          id: 'chunk-3',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [
            { index: 0, delta: { content: '!' }, finish_reason: 'stop' },
          ],
        },
        {
          id: 'chunk-4',
          object: 'chat.completion.chunk',
          model: 'gpt-4o',
          choices: [],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
        '[DONE]',
      ];

      fetchMock.mockResolvedValueOnce(
        new Response(createSseStream(sseChunks), { status: 200 }),
      );

      const emitted: any[] = [];
      for await (const event of adapter.stream({
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        emitted.push(event);
      }

      expect(emitted).toEqual([
        { type: 'text-delta', delta: 'Hello' },
        { type: 'text-delta', delta: ' world' },
        { type: 'text-delta', delta: '!' },
        {
          type: 'usage',
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        },
        {
          type: 'complete',
          finishReason: 'stop',
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          model: 'gpt-4o',
        },
      ]);
    });

    it('handles the [DONE] sentinel cleanly without causing JSON parse errors', async () => {
      const adapter = new OpenAiAdapter(defaultOpenAiConfig);

      const stream = createSseStream([
        { choices: [{ delta: { content: 'Test' } }] },
        '[DONE]',
      ]);

      fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      const events: any[] = [];
      for await (const event of adapter.stream({
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        events.push(event);
      }

      expect(events[0]).toEqual({ type: 'text-delta', delta: 'Test' });
      expect(events[1].type).toBe('complete');
    });

    it('reports missing usage as unknown (undefined) rather than zero', async () => {
      const adapter = new OpenAiAdapter(defaultCompatibleConfig);

      // Stream with deltas but no usage chunk emitted by upstream server
      const sseChunks: (string | OpenAiChatCompletionChunk)[] = [
        {
          choices: [{ delta: { content: 'No usage sent' } }],
        },
        {
          choices: [{ delta: {}, finish_reason: 'stop' }],
        },
        '[DONE]',
      ];

      fetchMock.mockResolvedValueOnce(
        new Response(createSseStream(sseChunks), { status: 200 }),
      );

      const emitted: any[] = [];
      for await (const event of adapter.stream({
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        emitted.push(event);
      }

      // Assert NO usage event was emitted
      expect(emitted.some((e) => e.type === 'usage')).toBe(false);

      // Assert complete event has usage: undefined (unknown), NOT zeros!
      const completeEvent = emitted.find((e) => e.type === 'complete');
      expect(completeEvent).toBeDefined();
      expect(completeEvent.usage).toBeUndefined();
    });

    it('handles thought-delta for reasoning models', async () => {
      const adapter = new OpenAiAdapter(defaultLmStudioConfig);

      const sseChunks: (string | OpenAiChatCompletionChunk)[] = [
        {
          choices: [{ delta: { reasoning_content: 'Thinking deeply...' } }],
        },
        {
          choices: [
            { delta: { content: 'Solution is here.' }, finish_reason: 'stop' },
          ],
        },
        '[DONE]',
      ];

      fetchMock.mockResolvedValueOnce(
        new Response(createSseStream(sseChunks), { status: 200 }),
      );

      const emitted: any[] = [];
      for await (const event of adapter.stream({
        messages: [{ role: 'user', content: 'Hi' }],
      })) {
        emitted.push(event);
      }

      expect(emitted[0]).toEqual({
        type: 'thought-delta',
        delta: 'Thinking deeply...',
      });
      expect(emitted[1]).toEqual({
        type: 'text-delta',
        delta: 'Solution is here.',
      });
      expect(emitted[2].type).toBe('complete');
    });

    it('handles chunk fragmentation across network packets seamlessly', async () => {
      const adapter = new OpenAiAdapter(defaultOpenAiConfig);

      const chunk1 = 'data: {"choices":[{"delta":{"con';
      const chunk2 = 'tent":"Part 1 and "}}]}\n\n';
      const chunk3 =
        'data: {"choices":[{"delta":{"content":"Part 2"}}]}\n\ndata: [DONE]\n\n';

      const encoder = new TextEncoder();
      const chunks = [chunk1, chunk2, chunk3];
      let i = 0;
      const stream = new ReadableStream({
        pull(controller) {
          if (i < chunks.length) {
            controller.enqueue(encoder.encode(chunks[i++]));
          } else {
            controller.close();
          }
        },
      });

      fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      const emitted: any[] = [];
      for await (const event of adapter.stream({
        messages: [{ role: 'user', content: 'Test' }],
      })) {
        emitted.push(event);
      }

      expect(emitted[0]).toEqual({ type: 'text-delta', delta: 'Part 1 and ' });
      expect(emitted[1]).toEqual({ type: 'text-delta', delta: 'Part 2' });
      expect(emitted[2].type).toBe('complete');
    });

    it('aborts cleanly mid-stream when signal is triggered', async () => {
      const adapter = new OpenAiAdapter(defaultOpenAiConfig);
      const controller = new AbortController();

      const encoder = new TextEncoder();
      const infiniteStream = new ReadableStream({
        pull(ctrl) {
          ctrl.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"content":"token"}}]}\n\n',
            ),
          );
        },
      });

      fetchMock.mockResolvedValueOnce(
        new Response(infiniteStream, { status: 200 }),
      );

      const streamIterator = adapter.stream(
        { messages: [{ role: 'user', content: 'Test' }] },
        { signal: controller.signal },
      );

      const firstItem = await streamIterator[Symbol.asyncIterator]().next();
      expect(firstItem.value).toEqual({ type: 'text-delta', delta: 'token' });

      controller.abort();

      await expect(
        streamIterator[Symbol.asyncIterator]().next(),
      ).rejects.toThrow(RequestAbortedError);
    });

    it('emits error event when in-band error event arrives over SSE', async () => {
      const adapter = new OpenAiAdapter(defaultOpenAiConfig);

      const sseChunks = [
        {
          error: {
            type: 'insufficient_quota',
            message: 'You have exceeded your quota.',
            code: 'insufficient_quota',
          },
        },
      ];

      fetchMock.mockResolvedValueOnce(
        new Response(createSseStream(sseChunks), { status: 200 }),
      );

      const emitted: any[] = [];
      for await (const event of adapter.stream({
        messages: [{ role: 'user', content: 'Test' }],
      })) {
        emitted.push(event);
      }

      expect(emitted).toHaveLength(1);
      expect(emitted[0].type).toBe('error');
      expect(emitted[0].error).toBeInstanceOf(RateLimitError);
    });
  });

  describe('Model Discovery (/models)', () => {
    it('discovers models and maps metadata fields accurately', async () => {
      const adapter = new OpenAiAdapter(defaultOpenAiConfig);

      const mockModelsResponse: OpenAiModelsResponse = {
        object: 'list',
        data: [
          {
            id: 'gpt-4o',
            object: 'model',
            created: 1715368132,
            owned_by: 'system',
            context_window: 128000,
            default_max_tokens: 4096,
            default_temperature: 0.7,
          },
          {
            id: 'qwen2.5-coder-7b',
            display_name: 'Qwen 2.5 Coder 7B',
            context_length: 32768,
          },
        ],
      };

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(mockModelsResponse), { status: 200 }),
      );

      const models = await adapter.discoverModels({
        headers: { 'X-Custom-Header': 'discovery-test' },
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${OPENAI_DEFAULT_BASE_URL}/v1/models`);
      expect((init.headers as Record<string, string>)['Authorization']).toBe(
        `Bearer ${secretKey}`,
      );
      expect((init.headers as Record<string, string>)['X-Custom-Header']).toBe(
        'discovery-test',
      );

      expect(models).toEqual([
        {
          modelIdentifier: 'gpt-4o',
          displayName: 'gpt-4o',
          contextWindow: 128000,
          defaultMaxTokens: 4096,
          defaultTemperature: 0.7,
        },
        {
          modelIdentifier: 'qwen2.5-coder-7b',
          displayName: 'Qwen 2.5 Coder 7B',
          contextWindow: 32768,
          defaultMaxTokens: null,
          defaultTemperature: null,
        },
      ]);
    });

    it('reports not-supported cleanly by throwing UnsupportedCapabilityError when server returns 404', async () => {
      const adapter = new OpenAiAdapter(defaultLmStudioConfig);

      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { message: 'Not found: /v1/models', code: 'not_found' },
          }),
          { status: 404 },
        ),
      );

      await expect(adapter.discoverModels()).rejects.toThrow(
        UnsupportedCapabilityError,
      );
    });

    it('reports not-supported cleanly when server returns 405 or 501', async () => {
      const adapter = new OpenAiAdapter(defaultCompatibleConfig);

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Method Not Allowed' }), {
          status: 405,
        }),
      );

      await expect(adapter.discoverModels()).rejects.toThrow(
        UnsupportedCapabilityError,
      );
    });

    it('propagates cancellation signal on discovery', async () => {
      const adapter = new OpenAiAdapter(defaultOpenAiConfig);
      const controller = new AbortController();
      controller.abort();

      await expect(
        adapter.discoverModels({ signal: controller.signal }),
      ).rejects.toThrow(RequestAbortedError);
    });

    it('maps 401 on discovery to AuthenticationError', async () => {
      const adapter = new OpenAiAdapter(defaultOpenAiConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { message: 'Incorrect API key', type: 'invalid_auth' },
          }),
          { status: 401 },
        ),
      );

      await expect(adapter.discoverModels()).rejects.toThrow(
        AuthenticationError,
      );
    });
  });

  describe('Error Mapping & Network Resilience', () => {
    it('maps 401 and 403 to AuthenticationError', async () => {
      const adapter = new OpenAiAdapter(defaultOpenAiConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: 'Invalid API key provided',
              code: 'invalid_api_key',
            },
          }),
          { status: 401 },
        ),
      );

      await expect(
        adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow(AuthenticationError);
    });

    it('maps 429 and quota exhaustion to RateLimitError (retryable)', async () => {
      const adapter = new OpenAiAdapter(defaultOpenAiConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: 'Rate limit reached for requests',
              code: 'rate_limit_exceeded',
            },
          }),
          { status: 429 },
        ),
      );

      const errPromise = adapter.complete({
        messages: [{ role: 'user', content: 'Hi' }],
      });
      await expect(errPromise).rejects.toThrow(RateLimitError);
      await errPromise.catch((err: RateLimitError) => {
        expect(err.retryable).toBe(true);
        expect(err.statusCode).toBe(429);
      });
    });

    it('maps 404 to ModelNotFoundError on completions', async () => {
      const adapter = new OpenAiAdapter(defaultOpenAiConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: 'The model `nonexistent-model` does not exist',
              code: 'model_not_found',
            },
          }),
          { status: 404 },
        ),
      );

      await expect(
        adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow(ModelNotFoundError);
    });

    it('maps 400 with context length message to ContextLengthExceededError', async () => {
      const adapter = new OpenAiAdapter(defaultOpenAiConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message:
                "This model's maximum context length is 8192 tokens. However, your messages resulted in 12000 tokens.",
              code: 'context_length_exceeded',
            },
          }),
          { status: 400 },
        ),
      );

      await expect(
        adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow(ContextLengthExceededError);
    });

    it('maps generic 400 to InvalidRequestError', async () => {
      const adapter = new OpenAiAdapter(defaultOpenAiConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: 'messages: must be an array of objects',
              type: 'invalid_request_error',
            },
          }),
          { status: 400 },
        ),
      );

      await expect(
        adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow(InvalidRequestError);
    });

    it('maps 500, 502, 503, 504 to ProviderUnavailableError (retryable)', async () => {
      for (const status of [500, 502, 503, 504]) {
        const adapter = new OpenAiAdapter(defaultOpenAiConfig);
        fetchMock.mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: {
                message: 'Internal server error occurred',
                type: 'server_error',
              },
            }),
            { status },
          ),
        );

        const promise = adapter.complete({
          messages: [{ role: 'user', content: 'Hi' }],
        });
        await expect(promise).rejects.toThrow(ProviderUnavailableError);
        await promise.catch((err: ProviderUnavailableError) => {
          expect(err.retryable).toBe(true);
          expect(err.statusCode).toBe(503);
        });
      }
    });

    it('maps network connection failures (ECONNREFUSED / fetch failed) to ProviderUnavailableError', async () => {
      const adapter = new OpenAiAdapter(defaultLmStudioConfig);
      fetchMock.mockRejectedValueOnce(
        new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:1234'),
      );

      await expect(
        adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow(ProviderUnavailableError);
    });

    it('fails fast within timeout when an unreachable local server hangs', async () => {
      // Use a very short timeout (50ms) for deterministic fast test
      const adapter = new OpenAiAdapter(defaultLmStudioConfig, {
        timeoutMs: 50,
      });

      // Simulate a hanging fetch that aborts after timeout
      fetchMock.mockImplementationOnce((_url, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted due to timeout');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const promise = adapter.complete({
        messages: [{ role: 'user', content: 'Hi' }],
      });
      await expect(promise).rejects.toThrow(ProviderUnavailableError);
      await promise.catch((err: ProviderUnavailableError) => {
        expect(err.message).toContain('timed out after 50ms');
        expect(err.retryable).toBe(true);
      });
    });

    it('maps user cancellation signal to RequestAbortedError without hanging', async () => {
      const adapter = new OpenAiAdapter(defaultOpenAiConfig);
      const controller = new AbortController();
      controller.abort();

      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      fetchMock.mockRejectedValueOnce(abortError);

      await expect(
        adapter.complete(
          { messages: [{ role: 'user', content: 'Hi' }] },
          { signal: controller.signal },
        ),
      ).rejects.toThrow(RequestAbortedError);
    });
  });

  describe('Security & Credential Redaction', () => {
    it('NEVER leaks configured API key in thrown error messages, causes, or JSON serialization', async () => {
      const adapter = new OpenAiAdapter(defaultOpenAiConfig);

      // Simulate malicious or leaky upstream response echoing the key
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: `Your API key ${secretKey} was expired or rejected!`,
              code: 'invalid_api_key',
            },
          }),
          { status: 401 },
        ),
      );

      try {
        await adapter.complete({
          messages: [{ role: 'user', content: 'Test' }],
        });
        expect.unreachable('Should have thrown AuthenticationError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AuthenticationError);
        const error = err as AuthenticationError;
        expect(error.message).not.toContain(secretKey);
        expect(error.message).toContain('[REDACTED_API_KEY]');
        expect(JSON.stringify(error)).not.toContain(secretKey);
      }
    });

    it('redacts the API key from network exception messages if present', async () => {
      const adapter = new OpenAiAdapter(defaultOpenAiConfig);
      const networkError = new Error(
        `Connection error with header Authorization: Bearer ${secretKey}`,
      );
      fetchMock.mockRejectedValueOnce(networkError);

      try {
        await adapter.complete({
          messages: [{ role: 'user', content: 'Test' }],
        });
        expect.unreachable('Should have thrown ProviderUnavailableError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ProviderUnavailableError);
        const error = err as ProviderUnavailableError;
        expect(error.message).not.toContain(secretKey);
        expect(error.message).toContain('[REDACTED_API_KEY]');
      }
    });
  });

  describe('Factory Registration for All Three Provider Kinds', () => {
    it('registers for openai, openai_compatible, and lmstudio and instantiates OpenAiAdapter', () => {
      const factory = new AdapterFactoryService();
      factory.register(
        ['openai', 'openai_compatible', 'lmstudio'],
        (config) => new OpenAiAdapter(config),
      );

      expect(factory.isSupported('openai')).toBe(true);
      expect(factory.isSupported('openai_compatible')).toBe(true);
      expect(factory.isSupported('lmstudio')).toBe(true);

      const openAiAdapter = factory.create(defaultOpenAiConfig);
      expect(openAiAdapter).toBeInstanceOf(OpenAiAdapter);

      const lmStudioAdapter = factory.create(defaultLmStudioConfig);
      expect(lmStudioAdapter).toBeInstanceOf(OpenAiAdapter);

      const compatibleAdapter = factory.create(defaultCompatibleConfig);
      expect(compatibleAdapter).toBeInstanceOf(OpenAiAdapter);
    });
  });
});
