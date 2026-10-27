import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthenticationError,
  ContextLengthExceededError,
  InvalidRequestError,
  ModelNotFoundError,
  ProviderUnavailableError,
  RateLimitError,
  RequestAbortedError,
} from '../errors/model-adapter-error.js';
import type { AdapterConfig, CompletionRequest } from '../types/index.js';
import {
  AnthropicAdapter,
  ANTHROPIC_API_VERSION,
  ANTHROPIC_DEFAULT_BASE_URL,
  ANTHROPIC_DEFAULT_MAX_TOKENS,
  ANTHROPIC_DEFAULT_MODEL,
} from './anthropic.adapter.js';
import type { AnthropicMessagesResponse } from './anthropic.types.js';

describe('AnthropicAdapter', () => {
  const secretKey = 'sk-ant-api03-very-secret-test-key-1234567890';
  const defaultConfig: AdapterConfig = {
    providerId: '018f3a9e-0000-7000-8000-000000000001',
    providerKind: 'anthropic',
    apiKey: secretKey,
    modelIdentifier: 'claude-3-5-sonnet-20241022',
  };

  const sampleSuccessResponse: AnthropicMessagesResponse = {
    id: 'msg_01X9DY2ASAcAQY',
    type: 'message',
    role: 'assistant',
    model: 'claude-3-5-sonnet-20241022',
    content: [
      {
        type: 'text',
        text: 'Hello! I am Claude.',
      },
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 15,
      output_tokens: 8,
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

  describe('Configuration & Defaults', () => {
    it('sets default capabilities correctly', () => {
      const adapter = new AnthropicAdapter(defaultConfig);
      expect(adapter.capabilities.supportsStreaming).toBe(true);
      expect(adapter.capabilities.supportsDiscovery).toBe(true);
      expect(adapter.capabilities.supportsSystemPrompt).toBe(true);
      expect(adapter.capabilities.supportsToolCalls).toBe(false);
    });

    it('defaults base URL to public endpoint if omitted or empty', () => {
      const adapter = new AnthropicAdapter({
        ...defaultConfig,
        baseUrl: null,
      });

      // Internal verification via buildMessagesPayload + executeFetch call
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );

      return adapter
        .complete({ messages: [{ role: 'user', content: 'Hi' }] })
        .then(() => {
          expect(fetchMock).toHaveBeenCalledTimes(1);
          const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
          expect(url).toBe(`${ANTHROPIC_DEFAULT_BASE_URL}/v1/messages`);
        });
    });

    it('honours custom baseUrl without trailing slash and handles /v1 suffix', async () => {
      // 1. Base URL without /v1
      const adapter1 = new AnthropicAdapter({
        ...defaultConfig,
        baseUrl: 'https://proxy.internal/anthropic/',
      });
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );
      await adapter1.complete({ messages: [{ role: 'user', content: 'Hi' }] });
      expect(fetchMock.mock.calls[0][0]).toBe('https://proxy.internal/anthropic/v1/messages');

      // 2. Base URL already ending with /v1
      const adapter2 = new AnthropicAdapter({
        ...defaultConfig,
        baseUrl: 'https://proxy.internal/anthropic/v1/',
      });
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );
      await adapter2.complete({ messages: [{ role: 'user', content: 'Hi' }] });
      expect(fetchMock.mock.calls[1][0]).toBe('https://proxy.internal/anthropic/v1/messages');
    });

    it('falls back to ANTHROPIC_DEFAULT_MODEL when modelIdentifier is undefined', () => {
      const adapter = new AnthropicAdapter({
        providerId: '018f3a9e-0000-7000-8000-000000000001',
        providerKind: 'anthropic',
      });
      const payload = adapter.buildMessagesPayload(
        { messages: [{ role: 'user', content: 'test' }] },
        false,
      );
      expect(payload.model).toBe(ANTHROPIC_DEFAULT_MODEL);
    });
  });

  describe('Headers and Authentication', () => {
    it('sends x-api-key, anthropic-version, and forwards custom headers', async () => {
      const adapter = new AnthropicAdapter(defaultConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );

      await adapter.complete(
        { messages: [{ role: 'user', content: 'Hi' }] },
        { headers: { 'X-Request-Id': 'req-xyz-123' } },
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;

      expect(headers['x-api-key']).toBe(secretKey);
      expect(headers['anthropic-version']).toBe(ANTHROPIC_API_VERSION);
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['X-Request-Id']).toBe('req-xyz-123');
    });

    it('omits x-api-key header if apiKey is undefined (e.g. gateway auth)', async () => {
      const adapter = new AnthropicAdapter({
        providerId: '018f3a9e-0000-7000-8000-000000000001',
        providerKind: 'anthropic',
        apiKey: undefined,
      });

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );

      await adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['x-api-key']).toBeUndefined();
      expect(headers['anthropic-version']).toBe(ANTHROPIC_API_VERSION);
    });
  });

  describe('Payload Translation & Turn Alternation', () => {
    it('uses documented max_tokens fallback (4096) when omitted', () => {
      const adapter = new AnthropicAdapter(defaultConfig);
      const payload = adapter.buildMessagesPayload(
        { messages: [{ role: 'user', content: 'Hello' }] },
        false,
      );
      expect(payload.max_tokens).toBe(ANTHROPIC_DEFAULT_MAX_TOKENS);
      expect(payload.max_tokens).toBe(4096);
    });

    it('respects explicitly provided maxTokens on request', () => {
      const adapter = new AnthropicAdapter(defaultConfig);
      const payload = adapter.buildMessagesPayload(
        { messages: [{ role: 'user', content: 'Hello' }], maxTokens: 1024 },
        false,
      );
      expect(payload.max_tokens).toBe(1024);
    });

    it('passes modelParams opaquely through to wire payload', () => {
      const adapter = new AnthropicAdapter(defaultConfig);
      const payload = adapter.buildMessagesPayload(
        {
          messages: [{ role: 'user', content: 'Hello' }],
          modelParams: {
            top_k: 20,
            stop_sequences: ['Human:', 'STOP'],
            extra_custom_field: true,
          },
        },
        false,
      );
      expect(payload.top_k).toBe(20);
      expect(payload.stop_sequences).toEqual(['Human:', 'STOP']);
      expect(payload['extra_custom_field']).toBe(true);
    });

    describe('System prompt hoisting', () => {
      it('hoists request.systemPrompt to top-level parameter', () => {
        const adapter = new AnthropicAdapter(defaultConfig);
        const payload = adapter.buildMessagesPayload(
          {
            systemPrompt: 'You are an expert tutor.',
            messages: [{ role: 'user', content: 'Help me.' }],
          },
          false,
        );

        expect(payload.system).toBe('You are an expert tutor.');
        expect(payload.messages).toEqual([{ role: 'user', content: 'Help me.' }]);
      });

      it('hoists messages with role === "system" and removes them from messages array', () => {
        const adapter = new AnthropicAdapter(defaultConfig);
        const payload = adapter.buildMessagesPayload(
          {
            messages: [
              { role: 'system', content: 'Instruction one.' },
              { role: 'user', content: 'Hello.' },
              { role: 'system', content: 'Instruction two.' },
            ],
          },
          false,
        );

        expect(payload.system).toBe('Instruction one.\n\nInstruction two.');
        expect(payload.messages).toEqual([{ role: 'user', content: 'Hello.' }]);
      });

      it('combines request.systemPrompt and system-role messages', () => {
        const adapter = new AnthropicAdapter(defaultConfig);
        const payload = adapter.buildMessagesPayload(
          {
            systemPrompt: 'Base prompt.',
            messages: [
              { role: 'system', content: 'Context note.' },
              { role: 'user', content: 'What is 2+2?' },
            ],
          },
          false,
        );

        expect(payload.system).toBe('Base prompt.\n\nContext note.');
        expect(payload.messages).toEqual([{ role: 'user', content: 'What is 2+2?' }]);
      });
    });

    describe('Consecutive same-role merging (team chats / agent succession)', () => {
      it('merges consecutive assistant messages separated by double newlines', () => {
        const adapter = new AnthropicAdapter(defaultConfig);
        const payload = adapter.buildMessagesPayload(
          {
            messages: [
              { role: 'user', content: 'Plan the trip.' },
              { role: 'assistant', name: 'Researcher', content: 'Here are hotels.' },
              { role: 'assistant', name: 'Planner', content: 'Here is the itinerary.' },
              { role: 'user', content: 'Great, thanks.' },
            ],
          },
          false,
        );

        expect(payload.messages).toEqual([
          { role: 'user', content: 'Plan the trip.' },
          {
            role: 'assistant',
            content: 'Researcher: Here are hotels.\n\nPlanner: Here is the itinerary.',
          },
          { role: 'user', content: 'Great, thanks.' },
        ]);
      });

      it('merges consecutive user messages', () => {
        const adapter = new AnthropicAdapter(defaultConfig);
        const payload = adapter.buildMessagesPayload(
          {
            messages: [
              { role: 'user', content: 'First thought.' },
              { role: 'user', content: 'Second thought.' },
            ],
          },
          false,
        );

        expect(payload.messages).toEqual([
          { role: 'user', content: 'First thought.\n\nSecond thought.' },
        ]);
      });

      it('prepends a user turn if conversation begins with assistant role', () => {
        const adapter = new AnthropicAdapter(defaultConfig);
        const payload = adapter.buildMessagesPayload(
          {
            messages: [
              { role: 'assistant', content: 'Pre-existing assistant message.' },
              { role: 'user', content: 'User followup.' },
            ],
          },
          false,
        );

        expect(payload.messages).toEqual([
          { role: 'user', content: ' ' },
          { role: 'assistant', content: 'Pre-existing assistant message.' },
          { role: 'user', content: 'User followup.' },
        ]);
      });

      it('supplies a default user turn if all messages were system prompts', () => {
        const adapter = new AnthropicAdapter(defaultConfig);
        const payload = adapter.buildMessagesPayload(
          {
            messages: [{ role: 'system', content: 'Just a system prompt' }],
          },
          false,
        );

        expect(payload.system).toBe('Just a system prompt');
        expect(payload.messages).toEqual([{ role: 'user', content: ' ' }]);
      });
    });
  });

  describe('complete() execution', () => {
    it('returns normalised completion with text content, usage, and finishReason', async () => {
      const adapter = new AnthropicAdapter(defaultConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );

      const request: CompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.3,
      };

      const result = await adapter.complete(request);

      expect(result.content).toBe('Hello! I am Claude.');
      expect(result.finishReason).toBe('stop');
      expect(result.model).toBe('claude-3-5-sonnet-20241022');
      expect(result.usage).toEqual({
        inputTokens: 15,
        outputTokens: 8,
        totalTokens: 23,
      });
      expect(result.reasoningContent).toBeUndefined();
    });

    it('extracts reasoningContent when thinking blocks are present', async () => {
      const adapter = new AnthropicAdapter(defaultConfig);
      const thinkingResponse: AnthropicMessagesResponse = {
        id: 'msg_think_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-3-7-sonnet',
        content: [
          {
            type: 'thinking',
            thinking: 'Let me analyze the math puzzle first...',
          },
          {
            type: 'text',
            text: 'The answer is 42.',
          },
        ],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 25 },
      };

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(thinkingResponse), { status: 200 }),
      );

      const result = await adapter.complete({
        messages: [{ role: 'user', content: 'Solve this' }],
      });

      expect(result.content).toBe('The answer is 42.');
      expect(result.reasoningContent).toBe('Let me analyze the math puzzle first...');
      expect(result.finishReason).toBe('stop');
    });

    it('maps Anthropic stop reasons accurately to normalised finishReason', async () => {
      const adapter = new AnthropicAdapter(defaultConfig);

      const testCases: [string, string][] = [
        ['end_turn', 'stop'],
        ['stop_sequence', 'stop'],
        ['max_tokens', 'length'],
        ['tool_use', 'tool_calls'],
        ['unknown_custom_reason', 'other'],
      ];

      for (const [anthropicReason, expectedFinish] of testCases) {
        fetchMock.mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              ...sampleSuccessResponse,
              stop_reason: anthropicReason,
            }),
            { status: 200 },
          ),
        );

        const res = await adapter.complete({
          messages: [{ role: 'user', content: 'Test' }],
        });
        expect(res.finishReason).toBe(expectedFinish);
      }
    });
  });

  describe('Error Mapping', () => {
    it('maps 401 and 403 to AuthenticationError', async () => {
      const adapter = new AnthropicAdapter(defaultConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: 'error',
            error: { type: 'authentication_error', message: 'invalid x-api-key' },
          }),
          { status: 401 },
        ),
      );

      await expect(
        adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow(AuthenticationError);
    });

    it('maps 404 to ModelNotFoundError', async () => {
      const adapter = new AnthropicAdapter(defaultConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: 'error',
            error: { type: 'not_found_error', message: 'model not found' },
          }),
          { status: 404 },
        ),
      );

      await expect(
        adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow(ModelNotFoundError);
    });

    it('maps 429 to RateLimitError (retryable)', async () => {
      const adapter = new AnthropicAdapter(defaultConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: 'error',
            error: { type: 'rate_limit_error', message: 'Too many requests' },
          }),
          { status: 429 },
        ),
      );

      const errPromise = adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] });
      await expect(errPromise).rejects.toThrow(RateLimitError);
      await errPromise.catch((err: RateLimitError) => {
        expect(err.retryable).toBe(true);
        expect(err.statusCode).toBe(429);
      });
    });

    it('maps 400 with context length keywords to ContextLengthExceededError', async () => {
      const adapter = new AnthropicAdapter(defaultConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: 'error',
            error: {
              type: 'invalid_request_error',
              message: 'prompt is too long: 250000 tokens > 200000 maximum context length',
            },
          }),
          { status: 400 },
        ),
      );

      await expect(
        adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow(ContextLengthExceededError);
    });

    it('maps other 400 errors to InvalidRequestError', async () => {
      const adapter = new AnthropicAdapter(defaultConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: 'error',
            error: {
              type: 'invalid_request_error',
              message: 'messages.0.content: String should have at least 1 character',
            },
          }),
          { status: 400 },
        ),
      );

      await expect(
        adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow(InvalidRequestError);
    });

    it('maps 529 (Anthropic Overloaded) to ProviderUnavailableError (retryable)', async () => {
      const adapter = new AnthropicAdapter(defaultConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: 'error',
            error: { type: 'overloaded_error', message: 'Anthropic is overloaded' },
          }),
          { status: 529 },
        ),
      );

      const errPromise = adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] });
      await expect(errPromise).rejects.toThrow(ProviderUnavailableError);
      await errPromise.catch((err: ProviderUnavailableError) => {
        expect(err.retryable).toBe(true);
        expect(err.message).toContain('overloaded');
      });
    });

    it('maps 500 and 503 to ProviderUnavailableError', async () => {
      const adapter = new AnthropicAdapter(defaultConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: 'error',
            error: { type: 'api_error', message: 'Internal server error' },
          }),
          { status: 500 },
        ),
      );

      await expect(
        adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow(ProviderUnavailableError);
    });

    it('maps AbortError to RequestAbortedError when signal aborts', async () => {
      const adapter = new AnthropicAdapter(defaultConfig);
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      fetchMock.mockRejectedValueOnce(abortError);

      const controller = new AbortController();
      controller.abort();

      await expect(
        adapter.complete(
          { messages: [{ role: 'user', content: 'Hi' }] },
          { signal: controller.signal },
        ),
      ).rejects.toThrow(RequestAbortedError);
    });

    it('maps generic fetch network failures to ProviderUnavailableError', async () => {
      const adapter = new AnthropicAdapter(defaultConfig);
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch (DNS lookup failed)'));

      await expect(
        adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow(ProviderUnavailableError);
    });
  });

  describe('Security: Credential Redaction & Privacy Guarantee', () => {
    it('NEVER leaks the API key in thrown error messages or causes, even if echoed upstream', async () => {
      const adapter = new AnthropicAdapter(defaultConfig);

      // Simulate malicious or leaky upstream response echoing the key
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: 'error',
            error: {
              type: 'authentication_error',
              message: `Your key ${secretKey} was expired or leaked!`,
            },
          }),
          { status: 401 },
        ),
      );

      try {
        await adapter.complete({ messages: [{ role: 'user', content: 'Test' }] });
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
      const adapter = new AnthropicAdapter(defaultConfig);
      const networkError = new Error(`Connection error with header x-api-key: ${secretKey}`);
      fetchMock.mockRejectedValueOnce(networkError);

      try {
        await adapter.complete({ messages: [{ role: 'user', content: 'Test' }] });
        expect.unreachable('Should have thrown ProviderUnavailableError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ProviderUnavailableError);
        const error = err as ProviderUnavailableError;
        expect(error.message).not.toContain(secretKey);
        expect(error.message).toContain('[REDACTED_API_KEY]');
      }
    });
  });
});
