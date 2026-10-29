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

### `OpenAiAdapter` (`openai/openai.adapter.ts`)
Adapter for OpenAI's Chat Completions and Models API (`providers.kind` values: `openai`, `openai_compatible`, `lmstudio`):
- **Provider Kinds**: Serves hosted OpenAI as well as local or custom compatible runtimes (LM Studio, vLLM, LocalAI, OpenRouter, Together).
- **Base URL Normalisation**: Accommodates user-supplied base URLs with or without a `/v1` path segment. If `/v1` is already present (e.g. `http://localhost:1234/v1`), paths are appended directly; if omitted (e.g. `http://localhost:1234`), `/v1` is automatically injected (`/v1/chat/completions`, `/v1/models`). Defaults to `https://api.openai.com` for kind `openai`.
- **System Prompt Placement**: Prepends normalised `request.systemPrompt` as the first message with role `system` in the messages array.
- **Flexible Authentication**: Transmits `Authorization: Bearer <key>` when a credential is configured. Sends no authorization header for local unauthenticated runtimes (e.g. default LM Studio).
- **Streaming (SSE)**: Consumes chunk deltas, yielding `text-delta` and `thought-delta` (reasoning models) events. Safely handles the non-JSON `[DONE]` termination sentinel without parse errors.
- **Tolerance & Defensive Parsing**: Reports missing streaming token usage as unknown (`usage: undefined`) rather than zero. Tolerates missing usage in compatible non-streaming responses.
- **Model Discovery & Graceful Degradation**: Queries `GET /models` to discover available models. When an upstream server returns 404, 405, or 501, reports "not supported" cleanly via `UnsupportedCapabilityError` rather than failing generically.
- **Fast Timeout & Cancellation**: Applies a 30s connection timeout (`OPENAI_DEFAULT_TIMEOUT_MS`) so unreachable local servers fail fast rather than hanging. Propagates `AbortSignal` for instantaneous client cancellation.
- **Credential Privacy**: Decrypted keys are strictly redacted from logs, error messages, and exception causes.

### `GoogleAdapter` (`google/google.adapter.ts`)
Adapter for Google's Gemini Generative Language API (`providers.kind = 'google'`):
- **GenerateContent Protocol**: Translates normalised requests to Gemini's `generateContent` and `streamGenerateContent` wire shapes.
- **Role & Turn Mapping**: Maps normalised `assistant` to Gemini `model` and vice versa. Hoists `request.systemPrompt` and any `role === 'system'` messages into the top-level `systemInstruction` field.
- **Turn Alternation & Merging**: Merges consecutive turns of the same role (e.g. multi-agent team responses) separated by `\n\n`, preserving participant name prefixes. Automatically prepends a blank user turn if the conversation begins with an assistant turn.
- **Content Parts Wrapping**: Correctly wraps content into `{ parts: [{ text }] }` and unwraps returned candidate parts. Multimodal extension point is documented for future media columns.
- **Nested Generation Config**: Maps `temperature` and `maxTokens` into `generationConfig.temperature` and `generationConfig.maxOutputTokens`. Opaquely passes through `request.modelParams`.
- **Safety Block Handling**: Intercepts `promptFeedback.blockReason` and candidate finish reasons (`SAFETY`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII`), converting them to actionable `InvalidRequestError`s instead of silently returning empty completions.
- **Streaming (SSE)**: Consumes Server-Sent Events with `?alt=sse`, yielding incremental `text-delta` and `thought-delta` (for reasoning models) events, and tracks cumulative `usage`.
- **Model Discovery**: Queries `GET /v1beta/models`, strips `models/` prefix, maps `inputTokenLimit` to `contextWindow`, and filters for models supporting `generateContent`.
- **Credential & URL Privacy**: API keys sent via `x-goog-api-key` header (or `?key=` query param) are strictly redacted across error output and logged URLs.

### `OllamaAdapter` (`ollama/ollama.adapter.ts`)
Adapter for Ollama, the local model runtime (`providers.kind = 'ollama'`):
- **Native Chat API**: Communicates via Ollama's native `POST /api/chat` and `GET /api/tags` endpoints for richer loading and execution diagnostics.
- **Zero Credential Dependency**: Operates entirely without credentials or API keys; warns nothing if omitted. Forwards optional bearer tokens for proxy authentication.
- **Zero Financial Cost Accounting**: Local inference incurs no monetary API expense (`usage_events.cost_usd` is evaluated to `0.0` rather than `null`).
- **Timeout Architecture**: Separates fast connection timeout (`OLLAMA_DEFAULT_CONNECT_TIMEOUT_MS = 5000`) from generous generation timeout (`OLLAMA_DEFAULT_GENERATION_TIMEOUT_MS = 300000`). The connect timer clears immediately once headers arrive so slow CPU inference is never cut off prematurely.
- **Actionable Local Error Mapping**:
  - Connection refused $\to$ Explains that Ollama is not running at the target URL and advises running `ollama serve`.
  - Model not found (404) $\to$ Names the missing model tag and advises running `ollama pull <model>`.
  - Model loading $\to$ Explains that model weights are currently loading into memory.
- **NDJSON Streaming**: Parses newline-delimited JSON streams, buffering partial lines split across TCP chunks. Extracts final token counts from terminating objects, reporting absent counts as unknown (`usage: undefined`) rather than zero.
- **Model Tag Integrity**: Preserves model tags verbatim (e.g. `qwen2.5:14b`) throughout requests and model discovery.
- **Cancellation**: Forwards `AbortSignal` to cancel outbound fetch requests, stopping local CPU/GPU computation on the Ollama daemon immediately.

