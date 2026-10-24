import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ModelAdapter } from '../model-adapter.interface.js';
import type {
  CompletionRequest,
  CompletionResponse,
  ModelCapabilities,
  StreamEvent,
} from '../types/index.js';

describe('ModelAdapter compile-time contract', () => {
  it('asserts that a valid implementation satisfies ModelAdapter', () => {
    class ValidAdapter implements ModelAdapter {
      readonly capabilities: ModelCapabilities = {
        supportsStreaming: true,
        supportsDiscovery: false,
        supportsSystemPrompt: true,
        supportsToolCalls: false,
      };

      async complete(_req: CompletionRequest): Promise<CompletionResponse> {
        return {
          content: 'valid',
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          model: 'm',
        };
      }

      async *stream(_req: CompletionRequest): AsyncIterable<StreamEvent> {
        yield { type: 'text-delta', delta: 'valid' };
      }
    }

    const adapter: ModelAdapter = new ValidAdapter();
    expect(adapter).toBeDefined();

    expectTypeOf(adapter.complete).toBeFunction();
    expectTypeOf(adapter.stream).toBeFunction();
    expectTypeOf(adapter.capabilities).toBeObject();
  });

  it('verifies that an implementation missing required methods fails type checking', () => {
    type MissingComplete = Omit<ModelAdapter, 'complete'>;
    // @ts-expect-error An adapter missing the required 'complete' method must not type-check as ModelAdapter
    const _missingComplete: ModelAdapter = {} as MissingComplete;

    type MissingStream = Omit<ModelAdapter, 'stream'>;
    // @ts-expect-error An adapter missing the required 'stream' method must not type-check as ModelAdapter
    const _missingStream: ModelAdapter = {} as MissingStream;

    type MissingCapabilities = Omit<ModelAdapter, 'capabilities'>;
    // @ts-expect-error An adapter missing the required 'capabilities' property must not type-check as ModelAdapter
    const _missingCapabilities: ModelAdapter = {} as MissingCapabilities;

    expect(_missingComplete).toBeDefined();
    expect(_missingStream).toBeDefined();
    expect(_missingCapabilities).toBeDefined();
  });
});
