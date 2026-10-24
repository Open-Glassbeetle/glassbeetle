import { describe, expect, it } from 'vitest';
import {
  RateLimitError,
  RequestAbortedError,
} from '../errors/model-adapter-error.js';
import type { CompletionRequest, StreamEvent } from '../types/index.js';
import { TestDoubleAdapter } from './test-double-adapter.js';

describe('TestDoubleAdapter', () => {
  const sampleRequest: CompletionRequest = {
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello model' },
    ],
    temperature: 0.7,
    maxTokens: 1000,
  };

  describe('complete()', () => {
    it('returns a deterministic default completion and records request history', async () => {
      const adapter = new TestDoubleAdapter();

      const response = await adapter.complete(sampleRequest);

      expect(response.content).toBe('Response to: "Hello model"');
      expect(response.finishReason).toBe('stop');
      expect(response.model).toBe('test-model-alpha');
      expect(response.usage.totalTokens).toBeGreaterThan(0);

      expect(adapter.completedRequests).toHaveLength(1);
      expect(adapter.completedRequests[0]).toBe(sampleRequest);
    });

    it('returns custom canned response', async () => {
      const adapter = new TestDoubleAdapter(
        { modelIdentifier: 'gpt-4o' },
        {
          cannedResponse: {
            content: 'Specific canned answer',
            finishReason: 'length',
            model: 'gpt-4o-2024-08-06',
            usage: { inputTokens: 5, outputTokens: 15, totalTokens: 20 },
          },
        },
      );

      const response = await adapter.complete(sampleRequest);

      expect(response.content).toBe('Specific canned answer');
      expect(response.finishReason).toBe('length');
      expect(response.model).toBe('gpt-4o-2024-08-06');
      expect(response.usage).toEqual({
        inputTokens: 5,
        outputTokens: 15,
        totalTokens: 20,
      });
    });

    it('cycles through canned responses queue', async () => {
      const adapter = new TestDoubleAdapter(
        {},
        {
          cannedResponses: [
            { content: 'First response' },
            { content: 'Second response' },
          ],
        },
      );

      const res1 = await adapter.complete(sampleRequest);
      const res2 = await adapter.complete(sampleRequest);
      const res3 = await adapter.complete(sampleRequest);

      expect(res1.content).toBe('First response');
      expect(res2.content).toBe('Second response');
      expect(res3.content).toBe('First response');
    });

    it('throws RequestAbortedError when signal is already aborted', async () => {
      const adapter = new TestDoubleAdapter();
      const controller = new AbortController();
      controller.abort();

      await expect(
        adapter.complete(sampleRequest, { signal: controller.signal }),
      ).rejects.toThrow(RequestAbortedError);

      expect(adapter.completedRequests).toHaveLength(0);
    });

    it('throws simulated error when configured', async () => {
      const adapter = new TestDoubleAdapter(
        {},
        {
          simulateError: new RateLimitError('Rate limit hit', 'openai'),
        },
      );

      await expect(adapter.complete(sampleRequest)).rejects.toThrow(
        RateLimitError,
      );
    });
  });

  describe('stream()', () => {
    it('emits expected sequence of text-delta chunks and complete event', async () => {
      const adapter = new TestDoubleAdapter(
        {},
        {
          cannedResponse: { content: 'Hello world from streaming' },
          streamChunkSize: 6,
        },
      );

      const events: StreamEvent[] = [];
      for await (const event of adapter.stream(sampleRequest)) {
        events.push(event);
      }

      // Check chunks
      const textDeltas = events.filter((e) => e.type === 'text-delta');
      expect(textDeltas.length).toBeGreaterThan(1);
      const joinedText = textDeltas.map((d: any) => d.delta).join('');
      expect(joinedText).toBe('Hello world from streaming');

      // Check complete event
      const completeEvent = events.find((e) => e.type === 'complete');
      expect(completeEvent).toBeDefined();
      expect(completeEvent?.type).toBe('complete');

      expect(adapter.streamedRequests).toHaveLength(1);
    });

    it('yields custom canned stream events if configured', async () => {
      const customEvents: StreamEvent[] = [
        { type: 'thought-delta', delta: 'Thinking...' },
        { type: 'text-delta', delta: 'Answer' },
        { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
        { type: 'complete', finishReason: 'stop' },
      ];

      const adapter = new TestDoubleAdapter(
        {},
        { cannedStreamEvents: customEvents },
      );

      const events: StreamEvent[] = [];
      for await (const event of adapter.stream(sampleRequest)) {
        events.push(event);
      }

      expect(events).toEqual(customEvents);
    });

    it('stops streaming when signal is aborted mid-stream', async () => {
      const controller = new AbortController();
      const adapter = new TestDoubleAdapter(
        {},
        {
          cannedResponse: { content: 'This is a long sentence meant to be cancelled mid-stream' },
          streamChunkSize: 5,
        },
      );

      const received: string[] = [];
      let abortedCaught = false;

      try {
        for await (const event of adapter.stream(sampleRequest, { signal: controller.signal })) {
          if (event.type === 'text-delta') {
            received.push(event.delta);
            if (received.length === 2) {
              controller.abort();
            }
          }
        }
      } catch (err) {
        if (err instanceof RequestAbortedError) {
          abortedCaught = true;
        }
      }

      expect(abortedCaught).toBe(true);
      expect(received).toHaveLength(2);
    });

    it('throws mid-stream error after failAfterChunks', async () => {
      const adapter = new TestDoubleAdapter(
        {},
        {
          cannedResponse: { content: 'Chunk1Chunk2Chunk3Chunk4' },
          streamChunkSize: 6,
          simulateError: new RateLimitError('Stream rate limited'),
          failAfterChunks: 2,
        },
      );

      const received: string[] = [];
      let errorCaught = false;

      try {
        for await (const event of adapter.stream(sampleRequest)) {
          if (event.type === 'text-delta') {
            received.push(event.delta);
          }
        }
      } catch (err) {
        if (err instanceof RateLimitError) {
          errorCaught = true;
        }
      }

      expect(errorCaught).toBe(true);
      expect(received).toHaveLength(2);
    });
  });

  describe('discoverModels()', () => {
    it('returns default models and records call history', async () => {
      const adapter = new TestDoubleAdapter();

      const models = await adapter.discoverModels();

      expect(models).toHaveLength(2);
      expect(models[0].modelIdentifier).toBe('test-model-alpha');
      expect(models[1].modelIdentifier).toBe('test-model-beta');

      expect(adapter.discoveryCalls).toHaveLength(1);
    });

    it('returns custom discovered models when configured', async () => {
      const customModels = [
        {
          modelIdentifier: 'custom-1',
          displayName: 'Custom 1',
        },
      ];
      const adapter = new TestDoubleAdapter({}, { discoveredModels: customModels });

      const models = await adapter.discoverModels();
      expect(models).toEqual(customModels);
    });

    it('throws RequestAbortedError when signal is aborted', async () => {
      const adapter = new TestDoubleAdapter();
      const controller = new AbortController();
      controller.abort();

      await expect(
        adapter.discoverModels({ signal: controller.signal }),
      ).rejects.toThrow(RequestAbortedError);
    });
  });

  describe('resetHistory()', () => {
    it('clears completedRequests, streamedRequests and discoveryCalls', async () => {
      const adapter = new TestDoubleAdapter();

      await adapter.complete(sampleRequest);
      for await (const _ of adapter.stream(sampleRequest)) {
        // iterate
      }
      await adapter.discoverModels();

      expect(adapter.completedRequests).toHaveLength(1);
      expect(adapter.streamedRequests).toHaveLength(1);
      expect(adapter.discoveryCalls).toHaveLength(1);

      adapter.resetHistory();

      expect(adapter.completedRequests).toHaveLength(0);
      expect(adapter.streamedRequests).toHaveLength(0);
      expect(adapter.discoveryCalls).toHaveLength(0);
    });
  });
});
