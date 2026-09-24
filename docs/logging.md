# Logging & Correlation IDs in Glassbeetle API

Glassbeetle runs as a local-first desktop application. Clear, self-contained, and greppable operational logging helps both local users and maintainers reading bug report attachments.

## Architecture

1. **Structured Logging**: Built on NestJS `Logger` and Node's `AsyncLocalStorage` (`node:async_hooks`).
2. **Request Correlation IDs**: Every HTTP request receives a correlation ID.
   - Reuses inbound `X-Request-Id` if provided.
   - Generates a UUID if omitted.
   - Echoes `X-Request-Id` in response headers.
   - Tracks request context across async calls without passing parameters through function signatures.
3. **Request/Response Logging**: Records `METHOD`, `PATH`, `STATUS_CODE`, and `DURATION_MS` for every HTTP request.

## Log Levels

The log level is controlled via the `GLASSBEETLE_LOG_LEVEL` environment variable.

| Level | Description & Usage in Glassbeetle |
| :--- | :--- |
| `error` | Unexpected runtime failures, 500 internal errors, unhandled exceptions. |
| `warn` | Recoverable errors, 4xx client errors, late exceptions after response headers sent. |
| `log` / `info` | Default level. Operational startup events, health probes, HTTP request summaries (`GET /api/v1/agents 200 - 12ms`). |
| `debug` | Detailed diagnostic messages and request/response body inspections (when `GLASSBEETLE_LOG_BODY=true`). |

## Configuration Environment Variables

| Variable | Values | Default | Description |
| :--- | :--- | :--- | :--- |
| `GLASSBEETLE_LOG_LEVEL` | `debug`, `log`, `info`, `warn`, `error` | `log` | Sets the minimum severity level emitted by the logger. |
| `GLASSBEETLE_LOG_BODY` | `true`, `false`, `1`, `0` | `false` | Enables logging of redacted request bodies (e.g. prompt messages). |

## Security & Redaction Rules

Secrets and credentials must **never** appear in plain text in log lines. The `redactSensitiveData` utility automatically sanitizes objects and headers before they are logged.

The following fields and headers are automatically redacted to `[REDACTED]`:
- `apiKey`, `api_key`
- `secret`
- `password`
- `token`, `authorization` (`Bearer [REDACTED]`)
- `encrypted_value`, `nonce`
- `credentials`
- `private_key`
