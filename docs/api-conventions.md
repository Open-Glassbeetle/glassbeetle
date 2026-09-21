# API conventions

How the Glassbeetle API is shaped. Every endpoint follows these rules, so a
contributor implementing one resource does not have to reverse-engineer how
another one behaves.

If you disagree with something here, open an issue — changing a convention once
is cheap, reconciling twenty endpoints that each chose differently is not.

## Routing and versioning

Every route lives under `/api/v1`.

The `api` prefix is a global prefix and the `v1` segment comes from Nest's URI
versioning (`apps/api/src/bootstrap.ts`). Versioning is configured rather than
baked into a prefix string so an individual controller can pin or opt out of a
version later without the rest of the API moving.

Nested resources are expressed in the controller path:

```ts
@Controller('agents/:agentId/memories')   // → /api/v1/agents/:agentId/memories
@Controller('providers/:providerId/credential')
```

An endpoint scoped to a parent **must** filter by that parent in its query, not
just read the child by its own id. Ids are globally unique, so
`WHERE id = ?` alone would happily return another agent's private memory
through a URL naming the wrong agent. Always `WHERE id = ? AND agent_id = ?`.

## Resource representation

The database is SQLite and the API is JSON; these do not use the same types.
Helpers live in `apps/api/src/common/persistence/`.

| Concern | Storage | API | Helper |
| --- | --- | --- | --- |
| Identifiers | `TEXT PRIMARY KEY` | string | `newId()` |
| Timestamps | `TEXT` | ISO-8601 UTC string | `nowIso()`, `toIso()`, `fromIso()` |
| Booleans | `INTEGER` 0/1 | `true` / `false` | `toDbBoolean()`, `fromDbBoolean()` |
| Arrays, objects | JSON-encoded `TEXT` | real arrays/objects | `serializeJsonColumn()`, `parseJsonColumn()` |
| Column names | `snake_case` | `camelCase` | — |

**Identifiers** are UUIDv7. The leading 48 bits are a Unix millisecond
timestamp, so ids sort lexicographically in creation order — which makes
`ORDER BY id` a usable, stable pagination tiebreaker without needing an index on
`created_at`. A random UUIDv4 could not do that.

**Timestamps** are ISO-8601 UTC with millisecond precision
(`2026-09-21T09:30:52.123Z`), generated in TypeScript rather than in SQL. This
matches what `data/backups/seed.sql` already writes, and it compares correctly
under SQLite's lexicographic `TEXT` comparison, so `ORDER BY created_at` and
`WHERE created_at >= ?` work without conversion.

`created_at` and `updated_at` are always server-managed. A client that sends
`id`, `createdAt` or `updatedAt` gets a `400`.

**Nullable columns** are emitted as `null`, not omitted. A client can then tell
"not set" from "field does not exist in this version of the API".

### Never serialised

Some columns exist for the server's benefit only and must never appear in a
response:

- `agents.picture_path`, `projects.image_path`, `artifacts.file_path`,
  `backups.file_path` — local filesystem paths. Expose a reference or a boolean
  instead; a path leaks the layout of the user's machine.
- `provider_credentials.encrypted_value`, `.nonce` — there is no endpoint that
  returns a credential's plaintext, and none should be added. `masked_preview`
  is the only credential value that may be returned.

## Request validation

A global `ValidationPipe` runs on every route with:

- `whitelist: true` — properties with no validation decorator are stripped
- `forbidNonWhitelisted: true` — unknown properties are **rejected**, so a client
  typo becomes a `400` rather than a silently ignored field
- `transform: true` with `enableImplicitConversion: false` — explicit `@Type()`
  conversions only

DTOs live in `apps/api/src/modules/<resource>/dto/` and are named
`create-<resource>.dto.ts`, `update-<resource>.dto.ts`. Update DTOs should
extend the create DTO via `PartialType` imported from **`@nestjs/swagger`** —
importing it from `@nestjs/mapped-types` instead produces a DTO that validates
correctly but is missing from the generated OpenAPI schema.

Validate anything the schema constrains with a `CHECK` in the DTO too — for
example `providers.kind`, `messages.role`, `backup_policy.frequency`. The
database constraint is the last line of defence, not the first: letting it fire
turns a client mistake into an opaque `500`.

## Error responses

Every error, from every endpoint, returns this envelope:

```json
{
  "statusCode": 404,
  "error": "Not Found",
  "code": "NOT_FOUND",
  "message": "Agent not found",
  "path": "/api/v1/agents/abc",
  "timestamp": "2026-09-21T09:30:52.123Z"
}
```

- `code` is stable and machine-readable; clients branch on it. It is derived
  from the HTTP status by default, and an exception may supply a more specific
  one (`throw new ConflictException({ code: 'AGENT_HAS_NO_MODEL', message: '…' })`).
- `message` is human-facing and may be reworded at any time.
- `details` is present only for validation failures and carries one string per
  failing constraint.

Raise errors with Nest's exception classes (`NotFoundException`,
`ConflictException`, …). The global filter in
`apps/api/src/common/filters/http-exception/http-exception.filter.ts` formats
them.

**Anything the application did not raise deliberately becomes a generic
`500`.** Unexpected errors carry SQLite messages, filesystem paths and upstream
provider responses; the real error is logged server-side and the client is told
only that something failed. Do not defeat this by catching an internal error and
rethrowing its message to the client.

Unmatched routes also return this envelope — see `registerNotFoundFallback`.
It must be registered *after* `app.init()`, or it shadows the routes it exists
to fall back from.

## Configuration

Settings are read through `AppConfigService`
(`apps/api/src/config/`), never from `process.env` in a service. The accessor
returns non-optional types, because defaults and validation have already run.

Invalid configuration fails at startup with a message naming the offending
setting. See `apps/api/.env.example` for every setting and its default; a `.env`
file is optional, as an installed desktop application must start without one.

The data directory resolves per-platform and never relative to the executable —
a packaged Tauri build runs from a read-only bundle.

## Security boundaries

The API binds to `127.0.0.1` and **has no authentication**. It is a single-user
local application, and the following two properties are what keep it safe:

1. **Loopback only.** It is not reachable from other machines.
2. **A CORS allowlist**, not origin reflection. Only the three origins the
   desktop app actually uses are allowed. Reflecting arbitrary origins would let
   any website the user happens to visit read their chats, agents and memories
   from `http://localhost:3000`. Credentials are deliberately not enabled.

Keep both when adding endpoints, and treat any change to them as
security-relevant.

## OpenAPI

The document is served at `/api/docs` (UI) and `/api/docs-json` (raw), and can
be written to a file with `npm run openapi:export`.

Annotate every endpoint:

```ts
@ApiTags('agents')
@Controller('agents')
export class AgentsController {
  @Get(':agentId')
  @ApiOperation({ summary: 'Retrieve an agent' })
  @ApiParam({ name: 'agentId', description: 'Agent identifier' })
  @ApiOkResponse({ type: AgentResponseDto })
  @ApiNotFoundResponse({ description: 'No agent with that id' })
  findOne(/* … */) {}
}
```

- `@ApiTags` on the controller, using one of the tags declared in
  `apps/api/src/openapi/openapi.ts`.
- `@ApiOperation` with a summary that says what the endpoint *does*, not what it
  is called.
- A response decorator for every status the endpoint can return, errors
  included.
- `@ApiProperty` / `@ApiPropertyOptional` on DTO fields with a description and a
  realistic example. `0.7` is a useful example for `temperature`; `"string"` is
  not.
- OpenAPI distinguishes *optional* from *nullable*. A field that is always
  present but may be `null` is not the same as one that may be absent — most
  agent fields are the former.

The `@nestjs/swagger` CLI plugin is deliberately **not** enabled. It only runs
under `nest build`, so enabling it would make the generated schema differ
between a built app and the Vitest/SWC test run. Annotate explicitly instead.

## Testing

- Unit tests sit next to the code as `*.spec.ts` and run with `npm test`.
- HTTP-level tests sit in `apps/api/test/` as `*.e2e-spec.ts` and run with
  `npm run test:e2e`.

E2E tests must apply `configureApp()` so they exercise the same pipeline
production uses. A test against a bare application — no validation, no error
envelope — proves very little about the real thing.
