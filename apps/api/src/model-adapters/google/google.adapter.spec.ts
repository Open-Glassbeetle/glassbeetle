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
  GoogleAdapter,
  GOOGLE_DEFAULT_API_VERSION,
  GOOGLE_DEFAULT_BASE_URL,
  GOOGLE_DEFAULT_MODEL,
} from './google.adapter.js';
import type {
  GeminiGenerateContentResponse,
  GeminiListModelsResponse,
} from './google.types.js';

describe('GoogleAdapter', () => {
  const secretKey = 'AIzaSyTestSecretApiKey-1234567890abcdef';
  const defaultGoogleConfig: AdapterConfig = {
    providerId: '018f3a9e-0000-7000-8000-000000000003',
    providerKind: 'google',
    apiKey: secretKey,
    modelIdentifier: 'gemini-1.5-flash',
  };

  const sampleSuccessResponse: GeminiGenerateContentResponse = {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text: 'Hello from Google Gemini!' }],
        },
        finishReason: 'STOP',
        index: 0,
      },
    ],
    usageMetadata: {
      promptTokenCount: 12,
      candidatesTokenCount: 6,
      totalTokenCount: 18,
    },
    modelVersion: 'gemini-1.5-flash-001',
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
    it('declares correct runtime capabilities', () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      expect(adapter.capabilities.supportsStreaming).toBe(true);
      expect(adapter.capabilities.supportsDiscovery).toBe(true);
      expect(adapter.capabilities.supportsSystemPrompt).toBe(true);
      expect(adapter.capabilities.supportsToolCalls).toBe(false);
    });

    it('defaults base URL to public endpoint if omitted or empty', async () => {
      const adapter = new GoogleAdapter({
        ...defaultGoogleConfig,
        baseUrl: null,
      });

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );

      await adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        `${GOOGLE_DEFAULT_BASE_URL}/${GOOGLE_DEFAULT_API_VERSION}/models/gemini-1.5-flash:generateContent`,
      );
    });

    it('honours custom baseUrl without trailing slash and handles /v1beta and /v1 prefixes', async () => {
      // 1. Base URL without version
      const adapter1 = new GoogleAdapter({
        ...defaultGoogleConfig,
        baseUrl: 'https://proxy.internal/gemini/',
      });
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );
      await adapter1.complete({ messages: [{ role: 'user', content: 'Hi' }] });
      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://proxy.internal/gemini/v1beta/models/gemini-1.5-flash:generateContent',
      );

      // 2. Base URL already ending with /v1beta
      const adapter2 = new GoogleAdapter({
        ...defaultGoogleConfig,
        baseUrl: 'https://proxy.internal/v1beta/',
      });
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );
      await adapter2.complete({ messages: [{ role: 'user', content: 'Hi' }] });
      expect(fetchMock.mock.calls[1][0]).toBe(
        'https://proxy.internal/v1beta/models/gemini-1.5-flash:generateContent',
      );

      // 3. Base URL with /v1
      const adapter3 = new GoogleAdapter({
        ...defaultGoogleConfig,
        baseUrl: 'https://proxy.internal/v1',
      });
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );
      await adapter3.complete({ messages: [{ role: 'user', content: 'Hi' }] });
      expect(fetchMock.mock.calls[2][0]).toBe(
        'https://proxy.internal/v1/models/gemini-1.5-flash:generateContent',
      );
    });

    it('falls back to GOOGLE_DEFAULT_MODEL when modelIdentifier is undefined', () => {
      const adapter = new GoogleAdapter({
        providerId: '018f3a9e-0000-7000-8000-000000000003',
        providerKind: 'google',
      });
      const payload = adapter.buildGenerateContentPayload({
        messages: [{ role: 'user', content: 'test' }],
      });
      expect(payload.contents[0].parts[0].text).toBe('test');
      expect((adapter as any).defaultModel).toBe(GOOGLE_DEFAULT_MODEL);
    });

    it('strips leading models/ prefix from model parameter if present', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );

      await adapter.complete({
        model: 'models/gemini-1.5-pro',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/models/gemini-1.5-pro:generateContent');
      expect(url).not.toContain('/models/models/');
    });
  });

  describe('Authentication & Placement', () => {
    it('sends x-goog-api-key header by default and forwards custom headers', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );

      await adapter.complete(
        { messages: [{ role: 'user', content: 'Hello' }] },
        { headers: { 'X-Custom-Trace': 'trace-123' } },
      );

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;

      expect(headers['x-goog-api-key']).toBe(secretKey);
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['X-Custom-Trace']).toBe('trace-123');
      expect(url).not.toContain(secretKey);
    });

    it('supports query-based authentication when authMethod is "query"', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig, {
        authMethod: 'query',
      });
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );

      await adapter.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;

      expect(headers['x-goog-api-key']).toBeUndefined();
      expect(url).toContain(`key=${secretKey}`);
    });

    it('omits authentication header and query param if apiKey is undefined', async () => {
      const adapter = new GoogleAdapter({
        providerId: '018f3a9e-0000-7000-8000-000000000003',
        providerKind: 'google',
      });
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );

      await adapter.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;

      expect(headers['x-goog-api-key']).toBeUndefined();
      expect(url).not.toContain('key=');
    });
  });

  describe('Payload Translation, Role Mapping & System Prompt Hoisting', () => {
    it('maps assistant role to model and user role to user', () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      const payload = adapter.buildGenerateContentPayload({
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there' },
          { role: 'user', content: 'How are you?' },
        ],
      });

      expect(payload.contents).toEqual([
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: 'Hi there' }] },
        { role: 'user', parts: [{ text: 'How are you?' }] },
      ]);
    });

    it('hoists request.systemPrompt and role="system" messages to top-level systemInstruction', () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      const payload = adapter.buildGenerateContentPayload({
        systemPrompt: 'You are a helpful coding assistant.',
        messages: [
          { role: 'system', content: 'Always format code in TypeScript.' },
          { role: 'user', content: 'Hello' },
        ],
      });

      expect(payload.systemInstruction).toBeDefined();
      expect(payload.systemInstruction?.parts).toEqual([
        {
          text: 'You are a helpful coding assistant.\n\nAlways format code in TypeScript.',
        },
      ]);
      // System message removed from contents
      expect(payload.contents).toEqual([
        { role: 'user', parts: [{ text: 'Hello' }] },
      ]);
    });

    it('omits systemInstruction when no system prompt or messages are present', () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      const payload = adapter.buildGenerateContentPayload({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(payload.systemInstruction).toBeUndefined();
    });

    it('merges consecutive same-role turns to satisfy Gemini alternation requirements', () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      // Simulate multi-agent team chat where two assistants speak sequentially
      const payload = adapter.buildGenerateContentPayload({
        messages: [
          { role: 'user', content: 'Solve this task' },
          { role: 'assistant', name: 'Researcher', content: 'Found 3 solutions.' },
          { role: 'assistant', name: 'Synthesizer', content: 'Solution 1 is best.' },
          { role: 'user', content: 'Great, go ahead' },
          { role: 'user', content: 'And make it fast' },
        ],
      });

      expect(payload.contents).toHaveLength(3);
      expect(payload.contents[0]).toEqual({
        role: 'user',
        parts: [{ text: 'Solve this task' }],
      });
      expect(payload.contents[1]).toEqual({
        role: 'model',
        parts: [
          { text: 'Researcher: Found 3 solutions.\n\nSynthesizer: Solution 1 is best.' },
        ],
      });
      expect(payload.contents[2]).toEqual({
        role: 'user',
        parts: [{ text: 'Great, go ahead\n\nAnd make it fast' }],
      });
    });

    it('prepends a user turn when conversation begins with assistant role', () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      const payload = adapter.buildGenerateContentPayload({
        messages: [{ role: 'assistant', content: 'Greeting initiated.' }],
      });

      expect(payload.contents).toHaveLength(2);
      expect(payload.contents[0]).toEqual({
        role: 'user',
        parts: [{ text: ' ' }],
      });
      expect(payload.contents[1]).toEqual({
        role: 'model',
        parts: [{ text: 'Greeting initiated.' }],
      });
    });

    it('handles empty conversation after system extraction by providing blank user turn', () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      const payload = adapter.buildGenerateContentPayload({
        systemPrompt: 'System instructions only',
        messages: [],
      });

      expect(payload.systemInstruction?.parts[0].text).toBe('System instructions only');
      expect(payload.contents).toEqual([
        { role: 'user', parts: [{ text: ' ' }] },
      ]);
    });

    it('maps generation parameters into nested generationConfig and passes modelParams opaquely', () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      const payload = adapter.buildGenerateContentPayload({
        temperature: 0.7,
        maxTokens: 2048,
        modelParams: {
          topP: 0.95,
          topK: 40,
          stopSequences: ['STOP'],
          safetySettings: [{ category: 'HARM_CATEGORY_DANGEROUS', threshold: 'BLOCK_LOW' }],
        },
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(payload.generationConfig).toEqual({
        temperature: 0.7,
        maxOutputTokens: 2048,
        topP: 0.95,
        topK: 40,
        stopSequences: ['STOP'],
      });
      // safetySettings is hoisted to top-level if present in modelParams
      expect(payload.safetySettings).toEqual([
        { category: 'HARM_CATEGORY_DANGEROUS', threshold: 'BLOCK_LOW' },
      ]);
    });
  });

  describe('Non-Streaming Completions', () => {
    it('executes completion and returns normalised response with usage and model', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSuccessResponse), { status: 200 }),
      );

      const request: CompletionRequest = {
        model: 'gemini-1.5-flash',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const response = await adapter.complete(request);

      expect(response.content).toBe('Hello from Google Gemini!');
      expect(response.finishReason).toBe('stop');
      expect(response.usage).toEqual({
        inputTokens: 12,
        outputTokens: 6,
        totalTokens: 18,
      });
      expect(response.model).toBe('gemini-1.5-flash-001');
      expect(response.raw).toEqual(sampleSuccessResponse);
    });

    it('extracts reasoningContent when thought parts are present', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      const thoughtResponse: GeminiGenerateContentResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { text: 'Thinking step 1...', thought: true },
                { text: 'Thinking step 2...', thought: true },
                { text: 'Here is the final answer.' },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 15,
          totalTokenCount: 25,
        },
        modelVersion: 'gemini-2.0-flash-thinking-exp',
      };

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(thoughtResponse), { status: 200 }),
      );

      const response = await adapter.complete({
        messages: [{ role: 'user', content: 'Solve puzzle' }],
      });

      expect(response.content).toBe('Here is the final answer.');
      expect(response.reasoningContent).toBe('Thinking step 1...Thinking step 2...');
      expect(response.model).toBe('gemini-2.0-flash-thinking-exp');
    });

    it('maps finish reasons correctly', () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      expect(adapter.mapFinishReason('STOP')).toBe('stop');
      expect(adapter.mapFinishReason('MAX_TOKENS')).toBe('length');
      expect(adapter.mapFinishReason('SAFETY')).toBe('content_filter');
      expect(adapter.mapFinishReason('RECITATION')).toBe('content_filter');
      expect(adapter.mapFinishReason('BLOCKLIST')).toBe('content_filter');
      expect(adapter.mapFinishReason('PROHIBITED_CONTENT')).toBe('content_filter');
      expect(adapter.mapFinishReason('SPII')).toBe('content_filter');
      expect(adapter.mapFinishReason('OTHER')).toBe('other');
      expect(adapter.mapFinishReason(undefined)).toBe('other');
    });

    it('throws InvalidRequestError when candidates array is empty', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
      );

      await expect(
        adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow(InvalidRequestError);
    });
  });

  describe('Safety Filtering & Actionable Error Mapping', () => {
    it('throws an actionable InvalidRequestError when prompt is blocked by safety filters', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      const safetyBlockedResponse: GeminiGenerateContentResponse = {
        promptFeedback: {
          blockReason: 'SAFETY',
          safetyRatings: [
            {
              category: 'HARM_CATEGORY_HATE_SPEECH',
              probability: 'HIGH',
              blocked: true,
            },
          ],
        },
      };

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(safetyBlockedResponse), { status: 200 }),
      );

      try {
        await adapter.complete({
          messages: [{ role: 'user', content: 'Harmful prompt' }],
        });
        expect.unreachable('Should have thrown an InvalidRequestError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(InvalidRequestError);
        const error = err as InvalidRequestError;
        expect(error.code).toBe('INVALID_REQUEST');
        expect(error.providerKind).toBe('google');
        expect(error.message).toContain('blocked by safety filters (SAFETY)');
        expect(error.message).toContain('HARM_CATEGORY_HATE_SPEECH (HIGH)');
      }
    });

    it('throws an actionable InvalidRequestError when candidate is blocked with finishReason="SAFETY"', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      const candidateBlockedResponse: GeminiGenerateContentResponse = {
        candidates: [
          {
            finishReason: 'SAFETY',
            safetyRatings: [
              {
                category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                probability: 'HIGH',
                blocked: true,
              },
            ],
          },
        ],
      };

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(candidateBlockedResponse), { status: 200 }),
      );

      try {
        await adapter.complete({
          messages: [{ role: 'user', content: 'Dangerous prompt' }],
        });
        expect.unreachable('Should have thrown an InvalidRequestError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(InvalidRequestError);
        const error = err as InvalidRequestError;
        expect(error.message).toContain('blocked by safety filters (SAFETY)');
        expect(error.message).toContain('HARM_CATEGORY_DANGEROUS_CONTENT (HIGH)');
      }
    });

    it('throws an actionable InvalidRequestError when candidate is blocked with finishReason="BLOCKLIST"', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      const blocklistResponse: GeminiGenerateContentResponse = {
        candidates: [
          {
            finishReason: 'BLOCKLIST',
          },
        ],
      };

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(blocklistResponse), { status: 200 }),
      );

      await expect(
        adapter.complete({ messages: [{ role: 'user', content: 'Blocked term' }] }),
      ).rejects.toThrow('blocked by safety filters (BLOCKLIST)');
    });
  });

  describe('Streaming Completions', () => {
    it('consumes SSE stream and yields incremental text deltas, usage, and complete events', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);

      const sseChunks = [
        'data: {"candidates": [{"content": {"parts": [{"text": "Hello"}], "role": "model"}, "index": 0}]}\n\n',
        'data: {"candidates": [{"content": {"parts": [{"text": " world"}], "role": "model"}, "index": 0}]}\n\n',
        'data: {"candidates": [{"content": {"parts": [{"text": "!"}], "role": "model"}, "finishReason": "STOP", "index": 0}], "usageMetadata": {"promptTokenCount": 5, "candidatesTokenCount": 3, "totalTokenCount": 8}, "modelVersion": "gemini-1.5-flash-001"}\n\n',
      ];

      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          for (const chunk of sseChunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      const events = [];
      for await (const event of adapter.stream({
        messages: [{ role: 'user', content: 'Say hello' }],
      })) {
        events.push(event);
      }

      // Assert outgoing URL has ?alt=sse
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain(':streamGenerateContent');
      expect(url).toContain('alt=sse');

      // Assert emitted events sequence
      expect(events).toEqual([
        { type: 'text-delta', delta: 'Hello' },
        { type: 'text-delta', delta: ' world' },
        { type: 'text-delta', delta: '!' },
        {
          type: 'usage',
          usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
        },
        {
          type: 'complete',
          finishReason: 'stop',
          usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
          model: 'gemini-1.5-flash-001',
        },
      ]);
    });

    it('yields thought-delta events for reasoning parts during streaming', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);

      const sseChunks = [
        'data: {"candidates": [{"content": {"parts": [{"text": "Analyzing...", "thought": true}], "role": "model"}}]}\n\n',
        'data: {"candidates": [{"content": {"parts": [{"text": "42"}], "role": "model"}, "finishReason": "STOP"}], "usageMetadata": {"promptTokenCount": 4, "candidatesTokenCount": 2, "totalTokenCount": 6}}\n\n',
      ];

      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          for (const chunk of sseChunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      const events = [];
      for await (const event of adapter.stream({
        messages: [{ role: 'user', content: 'What is 6x7?' }],
      })) {
        events.push(event);
      }

      expect(events[0]).toEqual({ type: 'thought-delta', delta: 'Analyzing...' });
      expect(events[1]).toEqual({ type: 'text-delta', delta: '42' });
      expect(events[2]).toEqual({
        type: 'usage',
        usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
      });
      expect(events[3]).toEqual({
        type: 'complete',
        finishReason: 'stop',
        usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
        model: 'gemini-1.5-flash',
      });
    });

    it('emits error event when streaming chunk contains prompt-level safety block', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);

      const sseChunks = [
        'data: {"promptFeedback": {"blockReason": "SAFETY", "safetyRatings": [{"category": "HARM_CATEGORY_SEXUAL", "probability": "HIGH"}]}}\n\n',
      ];

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseChunks[0]));
          controller.close();
        },
      });

      fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      const events = [];
      for await (const event of adapter.stream({
        messages: [{ role: 'user', content: 'Blocked prompt' }],
      })) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('error');
      const errEvent = events[0] as { type: 'error'; error: InvalidRequestError };
      expect(errEvent.error).toBeInstanceOf(InvalidRequestError);
      expect(errEvent.error.message).toContain('blocked by safety filters (SAFETY)');
    });

    it('emits error event when streaming candidate has finishReason="SAFETY"', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);

      const sseChunks = [
        'data: {"candidates": [{"content": {"parts": [{"text": "Partial"}]}}]}\n\n',
        'data: {"candidates": [{"finishReason": "SAFETY", "safetyRatings": [{"category": "HARM_CATEGORY_HARASSMENT", "probability": "HIGH"}]}]}\n\n',
      ];

      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          for (const chunk of sseChunks) {
            controller.enqueue(encoder.encode(chunk));
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

      expect(events[0]).toEqual({ type: 'text-delta', delta: 'Partial' });
      expect(events[1].type).toBe('error');
      const errEvent = events[1] as { type: 'error'; error: InvalidRequestError };
      expect(errEvent.error.message).toContain('blocked by safety filters (SAFETY)');
    });

    it('aborts mid-stream cleanly when cancellation signal is triggered', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      const abortController = new AbortController();

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"candidates": [{"content": {"parts": [{"text": "Part 1"}]}}]}\n\n',
            ),
          );
          // Trigger abort before sending remaining chunks
          abortController.abort();
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"candidates": [{"content": {"parts": [{"text": "Part 2"}]}}]}\n\n',
            ),
          );
          controller.close();
        },
      });

      fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));

      try {
        const iterable = adapter.stream(
          { messages: [{ role: 'user', content: 'Hi' }] },
          { signal: abortController.signal },
        );
        for await (const _ of iterable) {
          // process
        }
        expect.unreachable('Should have thrown RequestAbortedError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(RequestAbortedError);
        expect((err as RequestAbortedError).code).toBe('REQUEST_ABORTED');
      }
    });

    it('throws ProviderUnavailableError when streaming response body is empty', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

      await expect(
        (async () => {
          for await (const _ of adapter.stream({
            messages: [{ role: 'user', content: 'Hi' }],
          })) {
            // empty
          }
        })(),
      ).rejects.toThrow(ProviderUnavailableError);
    });
  });

  describe('Model Discovery', () => {
    it('discovers models, strips "models/" prefix, maps context limits and filters for generateContent', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);

      const discoveryResponse: GeminiListModelsResponse = {
        models: [
          {
            name: 'models/gemini-1.5-flash',
            version: '001',
            displayName: 'Gemini 1.5 Flash',
            description: 'Fast multimodal model',
            inputTokenLimit: 1048576,
            outputTokenLimit: 8192,
            supportedGenerationMethods: ['generateContent', 'countTokens'],
            temperature: 1.0,
            topP: 0.95,
            topK: 64,
          },
          {
            name: 'models/gemini-1.5-pro',
            displayName: 'Gemini 1.5 Pro',
            inputTokenLimit: 2097152,
            outputTokenLimit: 8192,
            supportedGenerationMethods: ['generateContent'],
            temperature: 1.0,
          },
          {
            name: 'models/text-embedding-004',
            displayName: 'Text Embedding 004',
            supportedGenerationMethods: ['embedContent'],
          },
        ],
      };

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(discoveryResponse), { status: 200 }),
      );

      const models = await adapter.discoverModels();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/v1beta/models');
      expect(url).toContain('pageSize=100');

      // Embedding model should be filtered out because it lacks 'generateContent'
      expect(models).toHaveLength(2);

      expect(models[0]).toEqual({
        modelIdentifier: 'gemini-1.5-flash',
        displayName: 'Gemini 1.5 Flash',
        contextWindow: 1048576,
        defaultMaxTokens: 8192,
        defaultTemperature: 1.0,
      });

      expect(models[1]).toEqual({
        modelIdentifier: 'gemini-1.5-pro',
        displayName: 'Gemini 1.5 Pro',
        contextWindow: 2097152,
        defaultMaxTokens: 8192,
        defaultTemperature: 1.0,
      });
    });

    it('follows pagination when nextPageToken is returned', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);

      const page1: GeminiListModelsResponse = {
        models: [
          {
            name: 'models/model-page-1',
            displayName: 'Model Page 1',
            inputTokenLimit: 128000,
            supportedGenerationMethods: ['generateContent'],
          },
        ],
        nextPageToken: 'token-page-2',
      };

      const page2: GeminiListModelsResponse = {
        models: [
          {
            name: 'models/model-page-2',
            displayName: 'Model Page 2',
            inputTokenLimit: 256000,
            supportedGenerationMethods: ['generateContent'],
          },
        ],
      };

      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify(page1), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(page2), { status: 200 }));

      const models = await adapter.discoverModels();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][0]).toContain('pageToken=token-page-2');
      expect(models).toHaveLength(2);
      expect(models[0].modelIdentifier).toBe('model-page-1');
      expect(models[1].modelIdentifier).toBe('model-page-2');
    });

    it('maps upstream 404 on discovery to UnsupportedCapabilityError', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: 404, message: 'Not found', status: 'NOT_FOUND' },
          }),
          { status: 404 },
        ),
      );

      await expect(adapter.discoverModels()).rejects.toThrow(
        UnsupportedCapabilityError,
      );
    });
  });

  describe('Error Mapping for All Classes', () => {
    it('maps 401 / UNAUTHENTICATED to AuthenticationError', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 401,
              message: 'API key not valid. Please pass a valid API key.',
              status: 'UNAUTHENTICATED',
            },
          }),
          { status: 401 },
        ),
      );

      await expect(
        adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow(AuthenticationError);
    });

    it('maps 403 / PERMISSION_DENIED to AuthenticationError', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 403,
              message: 'Method not allowed for caller credentials.',
              status: 'PERMISSION_DENIED',
            },
          }),
          { status: 403 },
        ),
      );

      await expect(
        adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow(AuthenticationError);
    });

    it('maps 404 / NOT_FOUND to ModelNotFoundError', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 404,
              message: 'Model gemini-fake is not found',
              status: 'NOT_FOUND',
            },
          }),
          { status: 404 },
        ),
      );

      await expect(
        adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow(ModelNotFoundError);
    });

    it('maps 429 / RESOURCE_EXHAUSTED to RateLimitError (retryable)', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 429,
              message: 'Resource exhausted: quota exceeded',
              status: 'RESOURCE_EXHAUSTED',
            },
          }),
          { status: 429 },
        ),
      );

      try {
        await adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] });
        expect.unreachable('Should have thrown RateLimitError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(RateLimitError);
        expect((err as RateLimitError).retryable).toBe(true);
        expect((err as RateLimitError).statusCode).toBe(429);
      }
    });

    it('maps 400 / INVALID_ARGUMENT to InvalidRequestError', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 400,
              message: 'Invalid argument: contents is required',
              status: 'INVALID_ARGUMENT',
            },
          }),
          { status: 400 },
        ),
      );

      await expect(
        adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow(InvalidRequestError);
    });

    it('maps 400 with token context limit exceeded to ContextLengthExceededError', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 400,
              message: 'Input token count exceeds maximum token limit of model',
              status: 'INVALID_ARGUMENT',
            },
          }),
          { status: 400 },
        ),
      );

      await expect(
        adapter.complete({ messages: [{ role: 'user', content: 'Huge prompt' }] }),
      ).rejects.toThrow(ContextLengthExceededError);
    });

    it('maps 503 / UNAVAILABLE to ProviderUnavailableError (retryable)', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 503,
              message: 'The service is currently unavailable.',
              status: 'UNAVAILABLE',
            },
          }),
          { status: 503 },
        ),
      );

      try {
        await adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] });
        expect.unreachable('Should have thrown ProviderUnavailableError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ProviderUnavailableError);
        expect((err as ProviderUnavailableError).retryable).toBe(true);
        expect((err as ProviderUnavailableError).statusCode).toBe(503);
      }
    });

    it('maps fetch network failure to ProviderUnavailableError', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await expect(
        adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow(ProviderUnavailableError);
    });

    it('maps caller AbortSignal rejection to RequestAbortedError', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      const controller = new AbortController();
      controller.abort();

      await expect(
        adapter.complete(
          { messages: [{ role: 'user', content: 'Hi' }] },
          { signal: controller.signal },
        ),
      ).rejects.toThrow(RequestAbortedError);
    });
  });

  describe('Credential Privacy & Redaction in Logs and URLs', () => {
    it('redacts the API key from error messages and serialized error output', async () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: `API key ${secretKey} was rejected!`,
              status: 'UNAUTHENTICATED',
            },
          }),
          { status: 401 },
        ),
      );

      try {
        await adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] });
        expect.unreachable('Should have thrown AuthenticationError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AuthenticationError);
        const error = err as AuthenticationError;
        expect(error.message).not.toContain(secretKey);
        expect(error.message).toContain('[REDACTED_API_KEY]');
        expect(JSON.stringify(error)).not.toContain(secretKey);
      }
    });

    it('redacts the API key from query-based URLs when logging or throwing network errors', async () => {
      const logMessages: string[] = [];
      const testLogger = {
        debug: (msg: string) => logMessages.push(msg),
      };

      const adapter = new GoogleAdapter(defaultGoogleConfig, {
        authMethod: 'query',
        logger: testLogger,
      });

      const networkError = new Error(
        `Failed to fetch https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${secretKey}`,
      );
      fetchMock.mockRejectedValueOnce(networkError);

      try {
        await adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] });
        expect.unreachable('Should have thrown ProviderUnavailableError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ProviderUnavailableError);
        const error = err as ProviderUnavailableError;
        // Verify key never appears in error message or serialized error
        expect(error.message).not.toContain(secretKey);
        expect(error.message).toContain('[REDACTED_API_KEY]');
        expect(JSON.stringify(error)).not.toContain(secretKey);

        // Verify key never appears in logged debug URLs
        expect(logMessages.length).toBeGreaterThan(0);
        for (const logMsg of logMessages) {
          expect(logMsg).not.toContain(secretKey);
          expect(logMsg).toContain('[REDACTED_API_KEY]');
        }
      }
    });

    it('sanitizeUrl method scrubs key parameter from arbitrary URLs', () => {
      const adapter = new GoogleAdapter(defaultGoogleConfig);
      const rawUrl1 = `https://generativelanguage.googleapis.com/v1beta/models?key=${secretKey}`;
      const rawUrl2 = `https://custom.gateway/v1/chat?foo=bar&key=${secretKey}&baz=qux`;

      expect(adapter.sanitizeUrl(rawUrl1)).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models?key=[REDACTED_API_KEY]',
      );
      expect(adapter.sanitizeUrl(rawUrl2)).toBe(
        'https://custom.gateway/v1/chat?foo=bar&key=[REDACTED_API_KEY]&baz=qux',
      );
      expect(adapter.sanitizeUrl(rawUrl1)).not.toContain(secretKey);
      expect(adapter.sanitizeUrl(rawUrl2)).not.toContain(secretKey);
    });
  });

  describe('Factory Registration', () => {
    it('registers for kind "google" and constructs GoogleAdapter instance', () => {
      const factory = new AdapterFactoryService();
      factory.register('google', (config) => new GoogleAdapter(config));

      expect(factory.isSupported('google')).toBe(true);
      expect(factory.getSupportedKinds()).toContain('google');

      const adapter = factory.create({
        providerId: '018f3a9e-0000-7000-8000-000000000003',
        providerKind: 'google',
        apiKey: secretKey,
      });

      expect(adapter).toBeInstanceOf(GoogleAdapter);
      expect(adapter.capabilities.supportsStreaming).toBe(true);
    });
  });
});
