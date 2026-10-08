# The user profile

Glassbeetle has agents, teams, chats and memories — and no representation of the
one person all of it belongs to. This document designs that resource.

It is the reasoning behind what is now implemented — the table, the endpoints
and the screen all exist. Conventions every endpoint shares live in
[`api-conventions.md`](api-conventions.md); this document is only about why this
resource is shaped the way it is.

## Why there is no `users` table

The API is single-user by construction. It binds to `127.0.0.1`, has no
authentication, and its security rests on exactly two properties — loopback
only, and a CORS allowlist (see
[`api-conventions.md`](api-conventions.md#security-boundaries)).

A `users` collection would quietly undo that. Collections have ids, ids get
foreign keys, foreign keys need an owner on every row, and an owner needs
something that authenticates it. The end of that road is a login screen in a
local desktop app.

So the resource is **not an identity principal**. It is a profile: the handful
of facts the app needs in order to address the person using it by name.

> **Rule.** No table ever gets a `user_id` column. Every row in this database
> already belongs to the one user; saying so again on each row only creates the
> illusion that it could belong to someone else.

## What it is for

Three consumers, in the order they will arrive:

1. **The UI** — a name and an avatar in the deck, a greeting, and a face beside
   the user's own messages instead of a generic bubble.
2. **Prompt assembly** — name, pronouns, locale, timezone and a free-text
   `about` belong in the system prompt, so an agent writes in the user's
   language, resolves "tomorrow" in the user's timezone, and does not have to
   guess their pronouns. `InferenceService` is still an empty stub, so nothing
   reads them yet: this is the reason the fields exist, not something the API
   does today. `includeInPrompts` is the switch that assembly must honour.
3. **Attribution** — `messages.role = 'user'` is already how a user turn is
   recorded. No foreign key is needed or wanted; the profile just gives that
   role a name to render.

## Shape: one singleton, not a collection

```
/api/v1/user
```

Singular noun, no id segment, no list. That makes the single-user property
structural instead of a convention a future contributor has to remember: there
is no URL that could name a second person.

> **Convention this establishes.** A plural path segment is a collection
> (`/agents`, `/chats`); a singular one is a singleton (`/user`, and
> `/application/backup-policy` once it is filled in).

Rejected alternatives:

- **`/me`** — the REST idiom for "the current principal", but there is no
  authentication here, so there is no *current* anything. It also reads as the
  natural sibling of `/users/:id`, which is precisely the door this design
  closes.
- **`/users/:id`** — multi-tenancy with one tenant. All of the cost, none of
  the benefit.
- **Folding it into `/application`** — `/application` is the app's own
  lifecycle: backups, restore, policy. The profile is the human's data, and it
  belongs in backups as content rather than as configuration.

## Endpoints

| Method   | Path                     | Status                | Notes |
| -------- | ------------------------ | --------------------- | ----- |
| `GET`    | `/api/v1/user`           | `200`                 | Always succeeds. Provisions the row on first read. |
| `PATCH`  | `/api/v1/user`           | `200`                 | Partial update, same null-vs-omitted contract as agents. |
| `PUT`    | `/api/v1/user/picture`   | `200`                 | `multipart/form-data`, replaces any existing avatar. |
| `GET`    | `/api/v1/user/picture`   | `200` / `404`         | Serves the image bytes. `404` when none is stored. |
| `DELETE` | `/api/v1/user/picture`   | `204`                 | Idempotent. |

There is deliberately **no `POST`** — nothing creates a second user — and **no
`DELETE /user`**. There is no account to close. A user who wants to be forgotten
deletes their data directory; a user who wants the profile blank sends
`PATCH` with nulls.

### `GET /user` never returns 404

This is the part that makes the design local-first rather than merely
offline-capable. There is no sign-up, so there is no state in which the
application has data but no user. The profile exists from the moment the
database does.

Concretely, the read provisions lazily, in one transaction:

```ts
const SINGLETON_SQL = `
  INSERT INTO user_profile (id, singleton, display_name, locale, timezone, created_at, updated_at)
  VALUES (?, 1, ?, ?, ?, ?, ?)
  ON CONFLICT (singleton) DO NOTHING
`;
```

followed by a plain `SELECT * FROM user_profile`. The `ON CONFLICT` makes it
safe under concurrent first requests, which a desktop app issues routinely — the
shell and the first screen both load at once.

What the seed contains is a judgment call worth stating out loud:

- `display_name` ← `os.userInfo().username`, overridable with
  `GLASSBEETLE_USER_NAME`. The machine already knows whose machine it is, and
  using that is the whole point of local-first: no onboarding form to fill in
  before the app is useful. It is a *seed*, not a lock — the first `PATCH`
  replaces it and nothing re-seeds afterwards.
- `locale` ← `Intl.DateTimeFormat().resolvedOptions().locale`
- `timezone` ← `Intl.DateTimeFormat().resolvedOptions().timeZone`

Every other field starts `null`. The alternative — seed nothing, show "You"
everywhere — is defensible, but it gives up a personalization the app can have
for free.

### `GET /user/picture` closes an existing gap

Agents can already be given a profile picture, and nothing ever serves it back:
`apps/web/src/app/features/agents/agent-avatar/agent-avatar.ts` renders initials
with a badge and a tooltip reading that the API does not return the picture yet.
An avatar that cannot be displayed is not personalization.

So this endpoint is part of the design, not a follow-up:

- Stream from `FileStorageService.createReadStream(row.picture_path)` — never
  read the whole file into memory to hand it straight back out.
- `Content-Type` from `stat()`, which derives it from the file's magic bytes,
  not from anything the client once claimed.
- `Content-Length` from `stat()`.
- `Content-Disposition: inline`, with no filename. The stored name is a UUIDv7
  and the original name was discarded on upload; echoing anything here would
  only invent information.
- `X-Content-Type-Options: nosniff`.
- `Cache-Control: private, max-age=0, must-revalidate` plus an `ETag` derived
  from `picture_updated_at`. The avatar is replaced in place at a stable URL, so
  without this the UI shows the old image until a reload.
- `404` with `code: 'PICTURE_NOT_FOUND'` when the column is null, and the same
  when the column is set but the file is missing — a restored database whose
  storage root did not come along should not produce a `500`.

The identical endpoint now belongs on `/agents/:agentId/picture` and
`/projects/:projectId/image`, with this one as the template. Until it is added,
`AgentAvatar` keeps showing a badge on the initials and saying why.

## The table

New file, `data/user/user_profile.sql`:

```sql
CREATE TABLE user_profile (
    id                  TEXT PRIMARY KEY,
    singleton           INTEGER NOT NULL DEFAULT 1 CHECK (singleton = 1) UNIQUE,
    display_name        TEXT,
    pronouns            TEXT,
    about               TEXT,                   -- Free text: what agents should know about the user
    locale              TEXT,                   -- BCP-47, e.g. 'de-CH'
    timezone            TEXT,                   -- IANA, e.g. 'Europe/Zurich'
    include_in_prompts  INTEGER NOT NULL DEFAULT 1,
    picture_path        TEXT,                   -- storage-relative reference, never serialised
    picture_updated_at  TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);
```

The `singleton` column is the enforcement: it may only ever hold `1`, and it is
`UNIQUE`, so a second row is impossible — the database refuses it, rather than
the service remembering to. `id` stays a normal UUIDv7 so the row obeys the
identifier convention and can be referred to in an export or a merged backup;
a hardcoded `id = 'local'` would have enforced the same thing while breaking
that convention.

`picture_updated_at` is separate from `updated_at` on purpose: the avatar's URL
is cached by the browser and the rest of the profile is not, so the two need
independent cache keys.

## Fields, and why each one earns its place

| Field | Why it exists |
| --- | --- |
| `displayName` | What the UI greets and what an agent calls the user. The one field personalization cannot do without. |
| `pronouns` | Goes into the prompt so an agent does not infer them from a name and get it wrong. Cheap to store, not derivable from anything else. |
| `about` | The local-first equivalent of user preferences: role, projects, tone to use, things to never do. One text field beats five structured ones nobody fills in. |
| `locale` | Which language an agent answers in, and how dates and numbers are formatted. |
| `timezone` | An agent resolving "tomorrow morning" needs it. UTC-only answers are wrong answers. |
| `includeInPrompts` | See [Privacy](#privacy-the-profile-leaves-the-machine). |
| `hasPicture` / avatar | The visual half of personalization. |

## Response representation

```json
{
  "id": "018f3a9e-0000-7000-8000-000000000001",
  "displayName": "Nathan",
  "pronouns": null,
  "about": "Works on Glassbeetle. Prefers short answers and real file paths.",
  "locale": "de-CH",
  "timezone": "Europe/Zurich",
  "includeInPrompts": true,
  "hasPicture": true,
  "pictureUpdatedAt": "2026-10-08T14:22:10.904Z",
  "createdAt": "2026-10-01T08:00:00.000Z",
  "updatedAt": "2026-10-08T14:22:10.904Z"
}
```

`picture_path` and `singleton` are never serialised. The path is a local
filesystem reference and leaks the layout of the user's machine — it joins the
"Never serialised" list in
[`api-conventions.md`](api-conventions.md#never-serialised). `singleton` is an
implementation detail of the constraint.

Nullable fields are emitted as `null`, never omitted, per convention.

## Validation

`UpdateUserProfileDto` — there is no create DTO, because there is no create.

| Field | Rule |
| --- | --- |
| `displayName` | trimmed, 1–120 chars, nullable |
| `pronouns` | trimmed, ≤ 60 chars, nullable |
| `about` | ≤ 4000 chars, nullable |
| `locale` | `Intl.getCanonicalLocales()` must accept it |
| `timezone` | must appear in `Intl.supportedValuesOf('timeZone')` |
| `includeInPrompts` | boolean |

`about`'s cap is a prompt budget, not a storage concern: this text is prepended
to every single completion, so 4000 characters is already a meaningful slice of
a small model's context window.

`locale` and `timezone` are validated against the platform's own ICU data rather
than a regex, because a syntactically valid timezone that ICU cannot resolve
would fail later, at formatting time, far from the request that accepted it.

The picture upload reuses what agents already enforce: `ALLOWED_PICTURE_MIME_TYPES`
(JPEG, PNG, WebP, GIF — SVG excluded, stored XSS), `maxPictureSizeBytes`, magic
byte detection, and an internally generated filename.

## What is deliberately left out

- **Email, password, tokens, OAuth.** Nothing authenticates and nothing sends
  mail. An email address here would be personal data with no consumer.
- **Theme, density, sidebar state and other UI preferences.** These belong in a
  separate `application/preferences` singleton. If they live on the profile,
  every theme toggle writes to the identity row and bumps its `updated_at` —
  and the profile slowly becomes the settings dump that nobody dares refactor.
- **Provider API keys.** Those are `provider_credentials`, encrypted at rest
  with AAD binding. Not here, not ever.
- **Multiple profiles or profile switching.** That is multi-user with extra
  steps, and it reopens every question this design closes.

## Privacy: the profile leaves the machine

`displayName`, `pronouns` and `about` are written for agents to read — which
means that for any remote provider, they are sent to a third party on every
completion. Everything else in Glassbeetle that leaves the machine does so
because the user typed it into a chat; this would be the first data that leaves
because the user filled in a settings form once, months earlier.

Hence `includeInPrompts`, default `true`, surfaced in the UI directly beside the
fields it governs rather than buried in a privacy screen. When it is off, prompt
assembly omits the profile block entirely.

Known simplification: the flag is not provider-aware. A local Ollama model and a
hosted Anthropic model are treated alike, even though only one of them is a
third party. Per-provider control is the obvious next iteration; one honest
boolean is better than an elaborate matrix nobody configures.

## Migration

`runMigrations()` applies `MIGRATION_FILE_SEQUENCE` exactly once, under the name
`001_initial_bootstrap`, and returns early ever after. **Appending the new file
to that sequence is not enough** — every existing installation has already
recorded `001` and would never see it.

Two changes, both needed, and both made:

1. `user/user_profile.sql` is in `MIGRATION_FILE_SEQUENCE` (it has no foreign
   keys, so its position is free) and in `FALLBACK_SQL`, for fresh databases.
2. `MIGRATIONS_AFTER_BOOTSTRAP` carries `002_user_profile` for existing ones.
   Each entry is applied in its own transaction and recorded in
   `schema_migrations`, and `CREATE TABLE IF NOT EXISTS` keeps it harmless on a
   database that just got the table from the sequence.

The DDL in a released migration is written out rather than shared with
`FALLBACK_SQL`: a migration is frozen history while the bootstrap DDL is free
to evolve, and a shared string would let an edit to the bootstrap retroactively
change what an already-applied migration claims to have done.

This was the project's first schema change after the initial bootstrap, so the
mechanism had to be built here regardless of this resource. Every schema change
from now on adds an entry to `MIGRATIONS_AFTER_BOOTSTRAP`.

## OpenAPI

The `user` tag is declared in `apps/api/src/openapi/openapi.ts` and every
endpoint is annotated per convention, including `@ApiProduces('image/jpeg',
'image/png', 'image/webp', 'image/gif')` on the picture download — a binary
response that the document describes as JSON is worse than undocumented.

`user.openapi.spec.ts` asserts the singleton in the document itself: exactly
two paths under `/api/v1/user`, neither carrying a parameter, and no `POST`,
`PUT` or `DELETE` on the resource.

## Frontend

- `core/api/user.models.ts` and `core/api/user.service.ts`, following
  `agents.service.ts`.
- `core/workspace/user-profile.service.ts` holds the profile in a signal,
  loaded once by the shell: the name and the avatar are in the chrome on every
  route. Unlike the roster it changes about once a year, so the profile screen
  hands the saved profile back rather than asking the shell to refetch.
- Avatar `src` is `${base}/user/picture?v=${pictureUpdatedAt}`. The query
  parameter is what makes a replaced avatar appear immediately, independently of
  the `ETag` round trip.
- `shared/ui/avatar.ts` draws a picture when there is one and initials when
  there is not, and falls back to initials when the image fails to load. The
  agent roster uses the same component, so there is one place that decides what
  an avatar looks like.
- The entry point is the deck's own avatar, at the end of the bar: the one
  control there that is about you rather than about the workspace. It is a link,
  so it behaves like an address.
- The screen carries the picture control, the text fields, the language and
  time zone with a "use this machine's settings" action, and
  `includeInPrompts` with its consequence spelled out beside it.
- No capability probe is needed. Unlike `models`, this endpoint is not promising
  something the schema cannot serve.

## Backups

The profile row travels with the database; the avatar lives in the existing
`pictures` bucket and travels with the storage root. Nothing in it is encrypted,
because nothing in it is a secret — which is also what makes it safe to include
in an export that a user might share, with the single exception of `about`,
whose contents are entirely up to them.
