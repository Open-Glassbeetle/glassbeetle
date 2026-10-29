import { describe, expect, it } from 'vitest';
import {
  AuthenticationError,
  AuthorizationError,
  ConnectionFailedError,
  ContentFilteredError,
  ContextLengthExceededError,
  InvalidRequestError,
  ModelNotFoundError,
  ModelAdapterError,
  type ModelAdapterErrorCode,
  ProviderUnavailableError,
  RateLimitError,
  RequestAbortedError,
  RequestCancelledError,
  RequestTimeoutError,
  UnknownModelAdapterError,
  UnsupportedCapabilityError,
  UnsupportedProviderKindError,
} from './model-adapter-error.js';
import {
  extractSafeErrorMessage,
  redactSecrets,
  sanitizeErrorCause,
} from './redact-error.js';
import {
  mapErrorCodeToHttpStatus,
  normalizeProviderError,
  toApiErrorResponse,
  toStreamErrorPayload,
} from './http-mapping.js';

describe('ModelAdapterError Taxonomy', () => {
  describe('Error Classes Construction & Machine-Readable Codes', () => {
    it('constructs AuthenticationError with stable code and HTTP 502', () => {
      const err = new AuthenticationError('Invalid API key', 'openai', {
        modelIdentifier: 'gpt-4o',
      });
      expect(err.code).toBe('AUTHENTICATION_FAILED');
      expect(err.statusCode).toBe(502);
      expect(err.retryable).toBe(false);
      expect(err.providerKind).toBe('openai');
      expect(err.modelIdentifier).toBe('gpt-4o');
      expect(err.model).toBe('gpt-4o');
      expect(err.isCancellation).toBe(false);
      expect(err.message).toBe('Invalid API key');
      expect(err instanceof ModelAdapterError).toBe(true);
    });

    it('constructs AuthorizationError with stable code and HTTP 502', () => {
      const err = new AuthorizationError('Lacks access to tier', 'anthropic');
      expect(err.code).toBe('AUTHORIZATION_FAILED');
      expect(err.statusCode).toBe(502);
      expect(err.retryable).toBe(false);
      expect(err.providerKind).toBe('anthropic');
    });

    it('constructs RateLimitError with stable code, HTTP 429, retryable, and retryAfterSeconds', () => {
      const err = new RateLimitError('Quota exceeded', 'openai', {
        retryAfterSeconds: 45,
      });
      expect(err.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(err.statusCode).toBe(429);
      expect(err.retryable).toBe(true);
      expect(err.retryAfterSeconds).toBe(45);
    });

    it('constructs InvalidRequestError with stable code and HTTP 400', () => {
      const err = new InvalidRequestError('Invalid temperature value', 'google');
      expect(err.code).toBe('INVALID_REQUEST');
      expect(err.statusCode).toBe(400);
      expect(err.retryable).toBe(false);
    });

    it('constructs ModelNotFoundError with stable code and HTTP 404', () => {
      const err = new ModelNotFoundError('claude-3-unknown', 'anthropic');
      expect(err.code).toBe('MODEL_NOT_FOUND');
      expect(err.statusCode).toBe(404);
      expect(err.retryable).toBe(false);
      expect(err.modelIdentifier).toBe('claude-3-unknown');
      expect(err.message).toContain('claude-3-unknown');
    });

    it('constructs ContentFilteredError with stable code and HTTP 422', () => {
      const err = new ContentFilteredError(
        'Blocked by Gemini safety filter',
        'google',
      );
      expect(err.code).toBe('CONTENT_FILTERED');
      expect(err.statusCode).toBe(422);
      expect(err.retryable).toBe(false);
    });

    it('constructs ContextLengthExceededError with stable code and HTTP 413', () => {
      const err = new ContextLengthExceededError(
        'Prompt has 150000 tokens > 128000 limit',
        'anthropic',
      );
      expect(err.code).toBe('CONTEXT_LENGTH_EXCEEDED');
      expect(err.statusCode).toBe(413);
      expect(err.retryable).toBe(false);
    });

    it('constructs ProviderUnavailableError with stable code and HTTP 503', () => {
      const err = new ProviderUnavailableError(
        'Anthropic 529 overloaded',
        'anthropic',
      );
      expect(err.code).toBe('PROVIDER_UNAVAILABLE');
      expect(err.statusCode).toBe(503);
      expect(err.retryable).toBe(true);
    });

    it('constructs ConnectionFailedError with stable code and HTTP 502', () => {
      const err = new ConnectionFailedError(
        'Ollama is not running at http://localhost:11434',
        'ollama',
      );
      expect(err.code).toBe('CONNECTION_FAILED');
      expect(err.statusCode).toBe(502);
      expect(err.retryable).toBe(true);
    });

    it('constructs RequestTimeoutError with stable code and HTTP 504', () => {
      const err = new RequestTimeoutError('Request timed out', 'openai');
      expect(err.code).toBe('REQUEST_TIMEOUT');
      expect(err.statusCode).toBe(504);
      expect(err.retryable).toBe(true);
    });

    it('constructs RequestAbortedError and RequestCancelledError with HTTP 499 and isCancellation: true', () => {
      const aborted = new RequestAbortedError('Aborted by client', 'ollama');
      expect(aborted.code).toBe('REQUEST_ABORTED');
      expect(aborted.statusCode).toBe(499);
      expect(aborted.retryable).toBe(false);
      expect(aborted.isCancellation).toBe(true);

      const cancelled = new RequestCancelledError('Cancelled by user', 'anthropic');
      expect(cancelled.code).toBe('REQUEST_ABORTED');
      expect(cancelled.statusCode).toBe(499);
      expect(cancelled.isCancellation).toBe(true);
      expect(cancelled instanceof RequestAbortedError).toBe(true);
    });

    it('constructs UnknownModelAdapterError with stable code and HTTP 502', () => {
      const err = new UnknownModelAdapterError('Unknown error', 'custom');
      expect(err.code).toBe('UNKNOWN_ERROR');
      expect(err.statusCode).toBe(502);
      expect(err.retryable).toBe(false);
    });

    it('constructs UnsupportedProviderKindError and UnsupportedCapabilityError with HTTP 400', () => {
      const unsupportedKind = new UnsupportedProviderKindError('cohere', [
        'openai',
        'anthropic',
      ]);
      expect(unsupportedKind.code).toBe('UNSUPPORTED_PROVIDER_KIND');
      expect(unsupportedKind.statusCode).toBe(400);

      const unsupportedCap = new UnsupportedCapabilityError(
        'discovery',
        'custom',
      );
      expect(unsupportedCap.code).toBe('UNSUPPORTED_CAPABILITY');
      expect(unsupportedCap.statusCode).toBe(400);
    });
  });

  describe('Cause Retained for Logging But Non-Serializable to Client', () => {
    it('retains cause for server inspection but omits cause from JSON.stringify and toJSON', () => {
      const sensitiveSecret = 'sk-ant-api03-TOP_SECRET_CREDENTIAL_1234567890';
      const rootCause = new Error(`Connection crashed with key ${sensitiveSecret}`);

      const error = new AuthenticationError('Authentication failed', 'anthropic', {
        cause: rootCause,
        modelIdentifier: 'claude-3-5-sonnet',
      });

      // 1. Direct server-side access to cause works for logger
      expect((error as unknown as { cause: Error }).cause).toBe(rootCause);
      expect((error as unknown as { cause: Error }).cause.message).toContain(
        sensitiveSecret,
      );

      // 2. Object.keys() does NOT include cause (non-enumerable)
      expect(Object.keys(error)).not.toContain('cause');

      // 3. Object spread {...error} does NOT copy cause
      const shallowCopy = { ...error };
      expect('cause' in shallowCopy).toBe(false);

      // 4. toJSON() returns clean object without cause
      const jsonObj = error.toJSON();
      expect(jsonObj.cause).toBeUndefined();
      expect(jsonObj.code).toBe('AUTHENTICATION_FAILED');
      expect(jsonObj.statusCode).toBe(502);
      expect(jsonObj.modelIdentifier).toBe('claude-3-5-sonnet');

      // 5. JSON.stringify() produces a string with ZERO mentions of cause or credential
      const serialized = JSON.stringify(error);
      expect(serialized).not.toContain('cause');
      expect(serialized).not.toContain(sensitiveSecret);
      expect(serialized).not.toContain('TOP_SECRET');
    });
  });

  describe('Redaction & Sanitization Helpers', () => {
    it('redacts Anthropic, OpenAI, and Google API keys from strings', () => {
      const rawText =
        'Failed key sk-proj-1234567890abcdef1234567890 and Anthropic sk-ant-api03-abcdef1234567890 and Gemini AIzaSyD1234567890abcdefghijklmnopqrstuvwxyz';
      const cleaned = redactSecrets(rawText);

      expect(cleaned).not.toContain('sk-proj-');
      expect(cleaned).not.toContain('sk-ant-');
      expect(cleaned).not.toContain('AIzaSy');
      expect(cleaned).toContain('[REDACTED_API_KEY]');
    });

    it('redacts configured known plain secrets', () => {
      const secret = 'custom-my-super-secret-password-xyz';
      const raw = `Bearer ${secret} in URL http://api?token=${secret}`;
      const cleaned = redactSecrets(raw, [secret]);

      expect(cleaned).not.toContain(secret);
      expect(cleaned).toContain('[REDACTED]');
    });

    it('redacts account, organization, and project identifiers', () => {
      const raw =
        'Rate limit for Organization: org-abcdef123456789 and Account: acc-9876543210 in project 987654321, user: user_12345';
      const cleaned = redactSecrets(raw);

      expect(cleaned).not.toContain('org-abcdef123456789');
      expect(cleaned).not.toContain('acc-9876543210');
      expect(cleaned).not.toContain('987654321');
      expect(cleaned).toContain('[REDACTED_ORG]');
      expect(cleaned).toContain('[REDACTED_ACCOUNT]');
      expect(cleaned).toContain('[REDACTED_PROJECT]');
      expect(cleaned).toContain('[REDACTED_USER]');
    });

    it('extracts safe error message from realistic Anthropic error body', () => {
      const anthropicBody = {
        type: 'error',
        error: {
          type: 'rate_limit_error',
          message:
            'Number of request tokens has exceeded your rate limit. Organization: org-123456789.',
        },
      };

      const extracted = extractSafeErrorMessage(anthropicBody);
      expect(extracted).toContain('exceeded your rate limit');
      expect(extracted).not.toContain('org-123456789');
      expect(extracted).toContain('[REDACTED_ORG]');
    });

    it('extracts safe error message from realistic OpenAI error body with leaked key', () => {
      const openAiBody = {
        error: {
          message:
            'Incorrect API key provided: sk-proj-1234567890abcdef1234567890. You can find your API key at https://platform.openai.com.',
          type: 'invalid_request_error',
          code: 'invalid_api_key',
        },
      };

      const extracted = extractSafeErrorMessage(openAiBody);
      expect(extracted).not.toContain('sk-proj-');
      expect(extracted).toContain('[REDACTED_API_KEY]');
    });

    it('extracts safe error message from Gemini safety block response', () => {
      const geminiBody = {
        promptFeedback: {
          blockReason: 'SAFETY',
          safetyRatings: [{ category: 'HARM_CATEGORY_HATE_SPEECH' }],
        },
      };

      const extracted = extractSafeErrorMessage(geminiBody);
      expect(extracted).toBe('Generation was blocked by Google Gemini safety filters.');
    });

    it('extracts safe error message from Ollama error body', () => {
      const ollamaBody = {
        error: "model 'mistral:latest' not found, try pulling it first",
      };

      const extracted = extractSafeErrorMessage(ollamaBody);
      expect(extracted).toBe("model 'mistral:latest' not found, try pulling it first");
    });

    it('truncates excessively long messages that could contain echoed prompts', () => {
      const giantEcho = `Invalid syntax near token: ${'A'.repeat(500)}`;
      const extracted = extractSafeErrorMessage({ error: { message: giantEcho } });

      expect(extracted.length).toBeLessThanOrEqual(300);
      expect(extracted.endsWith('...')).toBe(true);
    });

    it('sanitizes error cause for server-side logging without leaking secret keys', () => {
      const secret = 'sk-live-super-secret-key-12345678';
      const rawError = new Error(`Failed to send Bearer ${secret}`);
      const sanitized = sanitizeErrorCause(rawError, [secret]) as Error;

      expect(sanitized.message).not.toContain(secret);
      expect(sanitized.message).toContain('[REDACTED]');
    });
  });

  describe('HTTP Mapping & Stream Error Payload', () => {
    it('maps every ModelAdapterErrorCode to its expected HTTP status code', () => {
      const expectedMappings: Record<ModelAdapterErrorCode, number> = {
        AUTHENTICATION_FAILED: 502,
        AUTHORIZATION_FAILED: 502,
        RATE_LIMIT_EXCEEDED: 429,
        INVALID_REQUEST: 400,
        MODEL_NOT_FOUND: 404,
        CONTENT_FILTERED: 422,
        CONTEXT_LENGTH_EXCEEDED: 413,
        PROVIDER_UNAVAILABLE: 503,
        CONNECTION_FAILED: 502,
        REQUEST_TIMEOUT: 504,
        REQUEST_ABORTED: 499,
        UNKNOWN_ERROR: 502,
        UNSUPPORTED_PROVIDER_KIND: 400,
        UNSUPPORTED_CAPABILITY: 400,
      };

      for (const [code, status] of Object.entries(expectedMappings)) {
        expect(
          mapErrorCodeToHttpStatus(code as ModelAdapterErrorCode),
        ).toBe(status);
      }
    });

    it('transforms ModelAdapterError into standardized ApiErrorResponse envelope', () => {
      const err = new RateLimitError('Rate limit exceeded', 'openai');
      const response = toApiErrorResponse(err, '/api/v1/chats/123/completions');

      expect(response).toMatchObject({
        statusCode: 429,
        error: 'Too Many Requests',
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded',
        path: '/api/v1/chats/123/completions',
      });
      expect(response.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('transforms mid-stream errors into wire-safe StreamErrorPayload', () => {
      const err = new RateLimitError('Upstream limit reached', 'anthropic', {
        retryAfterSeconds: 30,
        modelIdentifier: 'claude-3-5-sonnet',
      });

      const payload = toStreamErrorPayload(err);
      expect(payload).toEqual({
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Upstream limit reached',
        retryable: true,
        providerKind: 'anthropic',
        model: 'claude-3-5-sonnet',
        retryAfterSeconds: 30,
      });

      // Non-adapter error fallback
      const unknownPayload = toStreamErrorPayload(new Error('Random crash'));
      expect(unknownPayload).toEqual({
        code: 'UNKNOWN_ERROR',
        message: 'An unexpected error occurred during generation.',
        retryable: false,
      });
    });
  });

  describe('Realistic Recorded Error Mapping Across All 4 Providers', () => {
    describe('Anthropic', () => {
      it('maps Anthropic 401 authentication_error to AuthenticationError (502)', () => {
        const mapped = normalizeProviderError({
          providerKind: 'anthropic',
          status: 401,
          errorBody: {
            type: 'error',
            error: { type: 'authentication_error', message: 'invalid x-api-key' },
          },
          model: 'claude-3-5-sonnet-20241022',
        });

        expect(mapped).toBeInstanceOf(AuthenticationError);
        expect(mapped.statusCode).toBe(502);
        expect(mapped.code).toBe('AUTHENTICATION_FAILED');
        expect(mapped.retryable).toBe(false);
      });

      it('maps Anthropic 404 not_found_error to ModelNotFoundError (404)', () => {
        const mapped = normalizeProviderError({
          providerKind: 'anthropic',
          status: 404,
          errorBody: {
            type: 'error',
            error: {
              type: 'not_found_error',
              message: 'model: claude-nonexistent not found',
            },
          },
          model: 'claude-nonexistent',
        });

        expect(mapped).toBeInstanceOf(ModelNotFoundError);
        expect(mapped.statusCode).toBe(404);
        expect(mapped.code).toBe('MODEL_NOT_FOUND');
      });

      it('maps Anthropic 429 rate_limit_error with Retry-After to RateLimitError (429)', () => {
        const mapped = normalizeProviderError({
          providerKind: 'anthropic',
          status: 429,
          errorBody: {
            type: 'error',
            error: {
              type: 'rate_limit_error',
              message: 'Number of request tokens exceeded rate limit',
            },
          },
          headers: { 'retry-after': '35' },
          model: 'claude-3-5-sonnet-20241022',
        });

        expect(mapped).toBeInstanceOf(RateLimitError);
        expect(mapped.statusCode).toBe(429);
        expect(mapped.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(mapped.retryable).toBe(true);
        expect(mapped.retryAfterSeconds).toBe(35);
      });

      it('maps Anthropic 400 prompt is too long to ContextLengthExceededError (413)', () => {
        const mapped = normalizeProviderError({
          providerKind: 'anthropic',
          status: 400,
          errorBody: {
            type: 'error',
            error: {
              type: 'invalid_request_error',
              message:
                'prompt is too long: 215000 tokens > 200000 maximum context length',
            },
          },
          model: 'claude-3-5-sonnet-20241022',
        });

        expect(mapped).toBeInstanceOf(ContextLengthExceededError);
        expect(mapped.statusCode).toBe(413);
        expect(mapped.code).toBe('CONTEXT_LENGTH_EXCEEDED');
      });

      it('maps Anthropic 529 overloaded_error to ProviderUnavailableError (503)', () => {
        const mapped = normalizeProviderError({
          providerKind: 'anthropic',
          status: 529,
          errorBody: {
            type: 'error',
            error: {
              type: 'overloaded_error',
              message: 'Anthropic is currently overloaded',
            },
          },
        });

        expect(mapped).toBeInstanceOf(ProviderUnavailableError);
        expect(mapped.statusCode).toBe(503);
        expect(mapped.retryable).toBe(true);
      });
    });

    describe('OpenAI', () => {
      it('maps OpenAI invalid_api_key to AuthenticationError (502) and redacts leaked key', () => {
        const leakedKey = 'sk-proj-abc12345678901234567890';
        const mapped = normalizeProviderError({
          providerKind: 'openai',
          status: 401,
          errorBody: {
            error: {
              message: `Incorrect API key provided: ${leakedKey}.`,
              type: 'invalid_request_error',
              code: 'invalid_api_key',
            },
          },
          knownSecrets: [leakedKey],
        });

        expect(mapped).toBeInstanceOf(AuthenticationError);
        expect(mapped.statusCode).toBe(502);
        expect(mapped.message).not.toContain(leakedKey);
      });

      it('maps OpenAI 403 permission_denied to AuthorizationError (502)', () => {
        const mapped = normalizeProviderError({
          providerKind: 'openai',
          status: 403,
          errorBody: {
            error: {
              message: 'You do not have access to model gpt-4o with your organization tier.',
              code: 'permission_denied',
            },
          },
        });

        expect(mapped).toBeInstanceOf(AuthorizationError);
        expect(mapped.statusCode).toBe(502);
        expect(mapped.code).toBe('AUTHORIZATION_FAILED');
      });

      it('maps OpenAI 400 context_length_exceeded to ContextLengthExceededError (413)', () => {
        const mapped = normalizeProviderError({
          providerKind: 'openai',
          status: 400,
          errorBody: {
            error: {
              message:
                "This model's maximum context length is 8192 tokens. However, your messages resulted in 10420 tokens.",
              code: 'context_length_exceeded',
            },
          },
        });

        expect(mapped).toBeInstanceOf(ContextLengthExceededError);
        expect(mapped.statusCode).toBe(413);
      });
    });

    describe('Google Gemini', () => {
      it('maps Google API_KEY_INVALID to AuthenticationError (502)', () => {
        const mapped = normalizeProviderError({
          providerKind: 'google',
          status: 400,
          errorBody: {
            error: {
              code: 400,
              message: 'API key not valid. Please pass a valid API key.',
              status: 'INVALID_ARGUMENT',
            },
          },
        });

        expect(mapped).toBeInstanceOf(AuthenticationError);
        expect(mapped.statusCode).toBe(502);
      });

      it('maps Google safety filter response to ContentFilteredError (422)', () => {
        const mapped = normalizeProviderError({
          providerKind: 'google',
          status: 200,
          errorBody: {
            promptFeedback: {
              blockReason: 'SAFETY',
            },
          },
        });

        expect(mapped).toBeInstanceOf(ContentFilteredError);
        expect(mapped.statusCode).toBe(422);
        expect(mapped.code).toBe('CONTENT_FILTERED');
      });

      it('maps Google 429 RESOURCE_EXHAUSTED to RateLimitError (429)', () => {
        const mapped = normalizeProviderError({
          providerKind: 'google',
          status: 429,
          errorBody: {
            error: {
              code: 429,
              message: 'Resource has been exhausted (e.g. check quota).',
              status: 'RESOURCE_EXHAUSTED',
            },
          },
        });

        expect(mapped).toBeInstanceOf(RateLimitError);
        expect(mapped.statusCode).toBe(429);
        expect(mapped.retryable).toBe(true);
      });
    });

    describe('Ollama', () => {
      it('maps ECONNREFUSED to ConnectionFailedError (502) with actionable message', () => {
        const connectionError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), {
          code: 'ECONNREFUSED',
        });

        const mapped = normalizeProviderError({
          providerKind: 'ollama',
          cause: connectionError,
          model: 'qwen2.5:14b',
        });

        expect(mapped).toBeInstanceOf(ConnectionFailedError);
        expect(mapped.statusCode).toBe(502);
        expect(mapped.code).toBe('CONNECTION_FAILED');
        expect(mapped.retryable).toBe(true);
        expect(mapped.message).toBe(
          'Ollama is not running at http://localhost:11434. Please ensure the Ollama daemon is started.',
        );
      });

      it('maps missing model to ModelNotFoundError (404) with actionable pull command', () => {
        const mapped = normalizeProviderError({
          providerKind: 'ollama',
          status: 404,
          errorBody: {
            error: "model 'llama3.1:70b' not found, try pulling it first",
          },
          model: 'llama3.1:70b',
        });

        expect(mapped).toBeInstanceOf(ModelNotFoundError);
        expect(mapped.statusCode).toBe(404);
        expect(mapped.message).toBe(
          'Model "llama3.1:70b" is not installed in Ollama. Run \'ollama pull llama3.1:70b\' to install it.',
        );
      });

      it('maps model loading/busy to ProviderUnavailableError (503)', () => {
        const mapped = normalizeProviderError({
          providerKind: 'ollama',
          status: 503,
          errorBody: {
            error: "model 'llama3.1:70b' is loading into memory, please wait",
          },
          model: 'llama3.1:70b',
        });

        expect(mapped).toBeInstanceOf(ProviderUnavailableError);
        expect(mapped.statusCode).toBe(503);
        expect(mapped.retryable).toBe(true);
      });
    });

    describe('Cancellation & Timeout', () => {
      it('maps AbortError to RequestAbortedError with isCancellation: true', () => {
        const abortErr = new Error('The operation was aborted');
        abortErr.name = 'AbortError';

        const mapped = normalizeProviderError({
          providerKind: 'anthropic',
          cause: abortErr,
        });

        expect(mapped).toBeInstanceOf(RequestAbortedError);
        expect(mapped.statusCode).toBe(499);
        expect(mapped.isCancellation).toBe(true);
      });

      it('maps ETIMEDOUT to RequestTimeoutError (504)', () => {
        const timeoutErr = Object.assign(new Error('Connection timed out'), {
          code: 'ETIMEDOUT',
        });

        const mapped = normalizeProviderError({
          providerKind: 'openai',
          cause: timeoutErr,
        });

        expect(mapped).toBeInstanceOf(RequestTimeoutError);
        expect(mapped.statusCode).toBe(504);
        expect(mapped.retryable).toBe(true);
      });
    });
  });
});
