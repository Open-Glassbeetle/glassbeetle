# Model Adapter Error Taxonomy & Normalization

This directory defines the error taxonomy that all provider adapters (`Anthropic`, `OpenAI`, `Google Gemini`, `Ollama`, etc.) map failures into, along with HTTP response mappings, redaction rules, and in-band streaming protocols.

---

## 1. Taxonomy & Machine-Readable Codes

Every provider failure MUST be mapped to one of the following canonical error classes and codes. Do not invent provider-specific error codes or leak vendor exception shapes.

| Error Class | Code | HTTP Status | Retryable | Description |
| :--- | :--- | :---: | :---: | :--- |
| `AuthenticationError` | `AUTHENTICATION_FAILED` | **502** | No | Missing, invalid, or expired API credential. |
| `AuthorizationError` | `AUTHORIZATION_FAILED` | **502** | No | Authenticated credential lacks permission for the model/tier. |
| `RateLimitError` | `RATE_LIMIT_EXCEEDED` | **429** | **Yes** | Upstream rate limit or quota exceeded. Supports `retryAfterSeconds`. |
| `InvalidRequestError` | `INVALID_REQUEST` | **400** | No | Parameter or request format rejected by provider. |
| `ModelNotFoundError` | `MODEL_NOT_FOUND` | **404** | No | Requested model identifier not found or not pulled in Ollama. |
| `ContentFilteredError` | `CONTENT_FILTERED` | **422** | No | Output generation blocked by safety, moderation, or harm filters. |
| `ContextLengthExceededError` | `CONTEXT_LENGTH_EXCEEDED` | **413** | No | Token count exceeds model's context window. Compaction target. |
| `ProviderUnavailableError` | `PROVIDER_UNAVAILABLE` | **503** | **Yes** | Upstream 5xx, maintenance, or overload (e.g. Anthropic 529). |
| `ConnectionFailedError` | `CONNECTION_FAILED` | **502** | **Yes** | Upstream server unreachable (e.g. Ollama daemon not running). |
| `RequestTimeoutError` | `REQUEST_TIMEOUT` | **504** | **Yes** | Upstream request timed out or gateway deadline expired. |
| `RequestAbortedError` | `REQUEST_ABORTED` | **499** | No | Request cancelled via `AbortSignal`. Client disconnect; not a failure. |
| `UnsupportedProviderKindError` | `UNSUPPORTED_PROVIDER_KIND` | **400** | No | Factory requested with unregistered provider kind. |
| `UnsupportedCapabilityError` | `UNSUPPORTED_CAPABILITY` | **400** | No | Operation not supported by adapter (e.g. discovery). |
| `UnknownModelAdapterError` | `UNKNOWN_ERROR` | **502** | No | Unclassified upstream error fallback. |

---

## 2. HTTP Mapping Justifications

When a `ModelAdapterError` reaches `HttpExceptionFilter`, it is converted into the standard `ApiErrorResponse` envelope. The HTTP status codes are chosen deliberately:

1. **Authentication Failures (502 Bad Gateway, NOT 401)**:
   The client provided a valid Glassbeetle session. The failure occurred between Glassbeetle and the external provider due to an invalid/expired upstream API key. Returning `401 Unauthorized` would erroneously signal to the Angular app that the user's session expired, triggering an unwanted logout and redirect to login.
2. **Authorization Failures (502 Bad Gateway, NOT 403)**:
   The user has full permission within Glassbeetle, but the upstream credential lacks access to that specific model or account tier. Returning `403 Forbidden` would imply the client is forbidden from using Glassbeetle.
3. **Connection Failures (502 Bad Gateway)**:
   The proxy/gateway was unable to establish a connection to the upstream server (e.g. `ECONNREFUSED` on `http://localhost:11434`).
4. **Content Filtered (422 Unprocessable Entity)**:
   The request was syntactically valid JSON matching API schema, but the semantic content violated provider safety filters (e.g. Gemini `blockReason: SAFETY`). `422` is standard HTTP for semantically invalid content.
5. **Context Length Exceeded (413 Payload Too Large)**:
   Keeps context length failures distinct from generic parameter validation (`400`). This allows agent orchestration to automatically intercept `413` and trigger conversation compaction (`chats.context_summary`).
6. **Cancelled Requests (499 Client Closed Request)**:
   When a user clicks "Stop" or navigates away, the `AbortSignal` fires. Cancellation is normal user behavior, marked with `isCancellation: true`. It is logged at `DEBUG` level and NEVER counted as a system failure in metrics.

---

## 3. Redaction & Credential Protection Rules

Upstream provider error bodies and raw network traces often contain sensitive data:
- API keys (`sk-...`, `AIza...`, `sk-ant-...`)
- Bearer tokens and authorization headers
- Organization identifiers (`org-...`), account IDs (`acc-...`), and Google project numbers
- Quota metrics and internal billing account links
- Echoed user prompt contents from malformed requests

### The Golden Rule
> **Raw upstream provider error bodies and credentials must NEVER reach client responses.**

### Implementation Protections
1. **Non-enumerable `cause`**:
   The `ModelAdapterError` base class retains the root underlying `cause` for server-side debugging, but sets `enumerable: false` and implements a custom `toJSON()` method that omits `cause`. Calling `JSON.stringify(error)` or spreading `{ ...error }` will never leak the cause.
2. **`extractSafeErrorMessage()`**:
   Adapters must use `extractSafeErrorMessage(body, fallback, [apiKey])` or `normalizeProviderError(...)` to parse messages safely without exposing raw JSON dumps or echoed prompts.
3. **`redactSecrets()`**:
   Automatically masks known API key patterns (`sk-*`, `AIza*`, `Bearer *`) and account/organization identifiers.

---

## 4. Message Quality Rules for Adapter Authors

A normalised error must be **actionable** where the cause is actionable. Generic errors waste user time.

### Worked Examples: Good vs. Bad Error Messages

| Failure Mode | Bad Message ❌ | Good Message ✅ | Why |
| :--- | :--- | :--- | :--- |
| **Local Ollama Daemon Down** | `upstream request failed` | `Ollama is not running at http://localhost:11434. Please ensure the Ollama daemon is started.` | Tells user exactly what is wrong and how to fix it on their machine. |
| **Model Not Pulled in Ollama** | `404 Not Found` | `Model "llama3.1:70b" is not installed in Ollama. Run 'ollama pull llama3.1:70b' to install it.` | Gives the exact CLI command to resolve the missing model. |
| **Provider Rate Limit** | `Error: 429 - {"type":"error","error":{"message":"rate limit for org_12345"}}` | `Anthropic rate limit exceeded. Retry after 30 seconds.` | Actionable, clean, and redacts internal organization IDs. |
| **Context Length Exceeded** | `Invalid request parameter` | `Context length exceeded: prompt contains 130,000 tokens, which exceeds the model limit of 128,000 tokens.` | Tells the caller why it failed so history can be compacted. |
| **Google Gemini Safety Block** | `HTTP 200 OK` or `API call failed` | `Google Gemini generation was blocked by safety filters (HARM_CATEGORY_HARASSMENT).` | Clarifies that the failure is a content policy block, not a network or syntax bug. |
| **Invalid Upstream API Key** | `Incorrect API key provided: sk-proj-1234567890abcdef` | `OpenAI authentication failed: Invalid API key. Check provider credential settings.` | Does NOT leak the secret key into the message or logs. |

---

## 5. Mid-Stream Error Protocol

Once a streaming completion starts, HTTP headers (`200 OK`, `Content-Type: text/event-stream`) have already been flushed. The HTTP status code cannot be modified, and `HttpExceptionFilter` cannot rewrite the response.

Mid-stream failures MUST travel **in-band** as a typed SSE event:

```
event: error
data: {"code":"RATE_LIMIT_EXCEEDED","message":"Anthropic rate limit exceeded. Retry after 20 seconds.","retryable":true,"providerKind":"anthropic","model":"claude-3-5-sonnet-20241022","retryAfterSeconds":20}
```

The wire payload adheres to the `StreamErrorPayload` interface defined in `apps/api/src/model-adapters/types/streaming.ts`:

```typescript
export interface StreamErrorPayload {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly providerKind?: string;
  readonly model?: string;
  readonly retryAfterSeconds?: number;
}
```

Adapter authors and completion controllers convert any error into this wire shape using `toStreamErrorPayload(error)`.

---

## 6. Adapter Author Checklist

When implementing an adapter:
1. Wrap all network calls in try/catch.
2. Check for `AbortSignal` cancellation first: throw `new RequestAbortedError()`.
3. Bound outbound requests with a deadline (clear the timer once response headers arrive) and throw `new RequestTimeoutError()` when it fires — do not rely on the runtime's default idle timeout.
4. Check for connection errors (`ECONNREFUSED`): throw `new ConnectionFailedError()`.
5. Parse upstream responses with `normalizeProviderError()` or `extractSafeErrorMessage()`.
6. Pass configured API keys to `knownSecrets` so they are scrubbed before logging.
7. In `stream()`, if a failure occurs mid-generation, yield `{ type: 'error', error, payload: toStreamErrorPayload(error) }` before terminating.
