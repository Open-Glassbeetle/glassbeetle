# Model Adapters Architecture

This module defines the provider-agnostic inference abstraction layer for Glassbeetle (`apps/api`).

It decouples core orchestration (chats, agents, teams, completions, memory) from specific AI vendor APIs (`anthropic`, `openai`, `google`, `ollama`, `lmstudio`, `openai_compatible`).

---

## 1. Core Abstractions

### `ModelAdapter` Interface (`model-adapter.interface.ts`)
The unified contract every provider integration implements:

```ts
export interface ModelAdapter {
  readonly capabilities: ModelCapabilities;

  complete(
    request: CompletionRequest,
    options?: CompletionOptions,
  ): Promise<CompletionResponse>;

  stream(
    request: CompletionRequest,
    options?: CompletionOptions,
  ): AsyncIterable<StreamEvent>;

  discoverModels?(options?: DiscoveryOptions): Promise<DiscoveredModel[]>;
}
```

### `AdapterFactoryService` (`adapter-factory/adapter-factory.service.ts`)
A dynamic registry factory resolving adapters by `providers.kind`:
- **Decoupled Registration**: Adapters register themselves without editing a central switch statement.
- **Many-to-One Mapping**: Several provider kinds (`lmstudio`, `openai_compatible`, `openai`) can register against a single OpenAI protocol adapter.
- **Fail-Safe**: Fails cleanly with `UnsupportedProviderKindError` when an unregistered kind is requested.

---

## 2. Key Design Decisions

### 2.1 System Prompt Normalisation
Providers disagree on how system instructions are formatted:
- **Anthropic**: Requires a top-level string (`system: "..."`).
- **OpenAI / Ollama**: Expects a message with `role: "system"` in the conversation array.

`CompletionRequest` normalises this by exposing a top-level `systemPrompt?: string` alongside `messages: AdapterMessage[]`. Each adapter translates into its target wire protocol without caller coordination.

### 2.2 Streaming Protocol Alignment
Aligned with `docs/realtime-transport.md` (SSE over HTTP):
`ModelAdapter.stream()` returns an `AsyncIterable<StreamEvent>` yielding structured typed events:
- `{ type: 'text-delta', delta: '...' }`
- `{ type: 'thought-delta', delta: '...' }` (for reasoning models)
- `{ type: 'usage', usage: { inputTokens, outputTokens, totalTokens } }`
- `{ type: 'complete', finishReason: 'stop', usage: ... }`
- `{ type: 'error', error: ModelAdapterError }`

### 2.3 Security & Decrypted Credential Privacy
- The adapter receives the decrypted API key via `AdapterConfig.apiKey`.
- **CRITICAL CONTRACT**: Adapters **must never log, print, cache, or echo** the API key in responses, diagnostics, or thrown errors.
- Thrown `ModelAdapterError` objects must never attach credentials or the `AdapterConfig` object to error properties.

### 2.4 Cancellation via `AbortSignal`
All methods accept `signal?: AbortSignal`. Adapters forward the signal directly to `fetch({ signal })`. When aborted, adapters immediately terminate in-flight connections and throw `RequestAbortedError`.

### 2.5 Error Normalisation Seam
Adapters catch vendor-specific exceptions and throw normalised errors derived from `ModelAdapterError`:
- `AuthenticationError` (401)
- `RateLimitError` (429, `retryable: true`)
- `InvalidRequestError` (400)
- `ModelNotFoundError` (404)
- `ContextLengthExceededError` (400)
- `ProviderUnavailableError` (503, `retryable: true`)
- `RequestAbortedError` (499)
- `UnsupportedCapabilityError` (400)
- `UnsupportedProviderKindError` (400)

---

## 3. Worked Example: Implementing an Adapter

See [`examples/worked-example-adapter.ts`](examples/worked-example-adapter.ts) for a full implementation using native Node.js `fetch`.

```ts
import { ModelAdapter, AdapterConfig, CompletionRequest, CompletionResponse } from '../index.js';

export class MinimalCustomAdapter implements ModelAdapter {
  readonly capabilities = {
    supportsStreaming: false,
    supportsDiscovery: false,
    supportsSystemPrompt: true,
    supportsToolCalls: false,
  };

  constructor(private readonly config: AdapterConfig) {}

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const res = await fetch(`${this.config.baseUrl}/v1/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model ?? this.config.modelIdentifier,
        messages: request.messages,
      }),
    });

    const data = await res.json();
    return {
      content: data.text,
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      model: request.model ?? 'custom-model',
    };
  }

  async *stream(): AsyncIterable<StreamEvent> {
    throw new UnsupportedCapabilityError('streaming');
  }
}
```

### Registering with the Factory:
```ts
adapterFactory.register(['openai', 'lmstudio', 'openai_compatible'], (config) => {
  return new ExampleOpenAiCompatibleAdapter(config);
});
```

---

## 4. Test Double (`test/test-double-adapter.ts`)

Every downstream inference test suite uses `TestDoubleAdapter`:
```ts
import { TestDoubleAdapter } from '../test/test-double-adapter.js';

const adapter = new TestDoubleAdapter({ providerKind: 'openai' }, {
  cannedResponse: { content: 'Deterministic response' },
});

const response = await adapter.complete({ messages: [{ role: 'user', content: 'Hi' }] });
// response.content === 'Deterministic response'
```

---

## 5. Provider Adapters

### `AnthropicAdapter` (`anthropic/anthropic.adapter.ts`)
Adapter for Anthropic's Messages and Models API (`providers.kind = 'anthropic'`):
- **Messages API Protocol**: Translates normalised requests to Anthropic's Messages wire shape.
- **System Prompt Hoisting**: Extracts `request.systemPrompt` and any `role === 'system'` messages to the top-level `system` parameter.
- **Turn Alternation & Merging**: Automatically merges consecutive same-role turns (`user` or `assistant`) with `\n\n` separation (preserving participant names) and ensures conversation begins with a user turn.
- **Max Tokens Fallback**: Explicitly defaults to `ANTHROPIC_DEFAULT_MAX_TOKENS = 4096` when omitted.
- **Streaming (SSE)**: Consumes Server-Sent Events, yielding incremental text/thought deltas and accumulating token usage across `message_start` and `message_delta` events.
- **Model Discovery**: Interrogates `GET /v1/models` and extracts context windows and token limits.
- **Credential Privacy**: Never leaks API keys across errors, logs, or thrown exception causes.
