# Web

The Angular frontend. Runs at <http://localhost:4200> in development and is
loaded by the Tauri window; a packaged build serves the bundle in
`dist/web/browser`.

```bash
npm run dev:web          # just this app
npm test -w @glassbeetle/web
npm run build -w @glassbeetle/web
```

## What the UI covers

The UI deliberately shows only what the API implements. Chats, projects, teams,
providers, artifacts, analytics and backups exist as NestJS modules with empty
controllers, so there is nothing to render for them yet and no navigation entry
pointing at an empty page.

| Screen | Endpoints |
| --- | --- |
| Dashboard | `GET /health`, plus the `total` of each collection |
| Agents | `/agents`, `/agents/:agentId`, `/agents/:agentId/picture` |
| Agent memories (on an agent's page) | `/agents/:agentId/memories` |
| Shared memory | `/memories` |
| System prompts | `/system-prompts` |

Two gaps are worth knowing about, because the UI works around them:

- **No endpoint serves an agent's picture back.** `agents.picture_path` is never
  exposed and there is no download route, so `hasPicture` is all a client gets.
  Avatars are drawn from initials and an uploaded picture shows as a badge.
  `AgentAvatar` is the only place that changes when a download endpoint arrives.
- **No models or providers endpoints.** `modelId` is therefore a free-text field
  rather than a picker. `systemPromptId` *is* a picker, because that endpoint
  exists.

## Layout

```
src/app/
├── core/          Services with no UI: one per API resource, plus theme and
│                  notifications. Nothing here imports a component.
├── shared/        Reusable UI and the list-page SCSS partial.
└── features/      One folder per screen, each lazily loaded by the router.
```

## Conventions

**Talking to the API.** Every resource has a service extending `ApiClient`,
which holds the absolute base URL from `src/environments/`. The URL is absolute
on purpose: a packaged Tauri app is served from `tauri://localhost`, so a
relative `/api` would resolve against the custom protocol.

Query parameters go through `toHttpParams`, which drops `undefined`, `null` and
empty strings. An empty filter must not be sent — the API reads `?search=` as a
search for the empty string, not as the absence of a filter. The literal
`'null'` is preserved, because the agents endpoint uses it to select rows whose
foreign key is NULL.

**Errors.** `toApiError` normalises an `HttpErrorResponse` into the envelope
from [`docs/api-conventions.md`](../../docs/api-conventions.md). A status of 0
means the request never got a response, which is reported as "the API is
unreachable" rather than as whatever empty body came back — the remedy is
different from any error the API raised deliberately. Validation failures carry
one `details` entry per failing constraint, and the envelope's `message` for
them is a generic summary, so `describeApiError` shows the details instead.

**Patching.** A PATCH body carries only the fields that changed. An omitted key
leaves the column alone, an explicit `null` clears it, and `""` would store an
empty string the API then reports as set — so a field the user emptied is sent
as `null`, never as `""`. An unchanged form sends nothing, which the API treats
as a no-op and which keeps `updated_at` honest.

**Lists.** Paging, sorting and debounced search live in `ListState`, which every
collection screen instantiates as a component field. Requests go through
`switchMap`, so a slow page-1 response cannot land after a fast page-2 one.
Deleting the last row on a page steps back a page rather than leaving an empty
one. `resource()` and `rxResource()` would cover some of this, but both are
still marked experimental in Angular 21.

**Theming.** One `mat.theme()` built with `theme-type: color-scheme`, so light
and dark are a single stylesheet and switching only flips `color-scheme` on
`<html>`. Colours come from `--mat-sys-*` tokens; no component hard-codes a hex
value. Dark is the default.

**Offline assets.** The icon font is bundled (`material-symbols`) and the
typography uses the platform UI font. A packaged Tauri app cannot rely on
reaching the Google Fonts CDN.
