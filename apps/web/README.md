# Web

The Angular frontend — an agent workspace. Runs at <http://localhost:4200> in
development and is loaded by the Tauri window; a packaged build serves the
bundle in `dist/web/browser`.

```bash
npm run dev:web          # just this app
npm test -w @glassbeetle/web
npm run build -w @glassbeetle/web
```

## What the UI covers

The UI shows only what the API implements. Chats, projects, teams, providers,
artifacts, analytics and backups exist as NestJS modules with empty
controllers, so their routes 404 and they have no screens.

| Surface | Endpoints |
| --- | --- |
| Overview | `/health`, plus each collection's `total` and `updatedAt` |
| Agents · directory | `/agents` |
| Agents · workspace | `/agents/:agentId`, `/agents/:agentId/picture` |
| Agents · memory | `/agents/:agentId/memories` |
| Shared memory | `/memories` |
| System prompts | `/system-prompts` |

## What the UI does *not* invent

The schema in `data/` describes a product with chats, teams, tool calls,
artifacts and usage events. None of that has endpoints yet. Three places where
it would have been easy to mock something, and what is shown instead:

**Agent state is readiness, not activity.** There is no inference or chat
endpoint, so nothing reports whether an agent is doing anything. A "running"
badge would be a claim the UI could never back up. `core/agents/agent-readiness.ts`
instead derives readiness from stored configuration — is anything steering this
agent?

**The feed is recent changes, not a run history.** `usage_events` has no
endpoint. `core/activity/activity.service.ts` assembles the feed from the
`created_at` / `updated_at` every resource already carries, and the panel is
labelled as configuration history.

**The agent's Context tab is not a rendered prompt.** No endpoint composes one.
The tab shows the configured layers — system prompt, personality, instructions,
shared and private memory — each with its real size and source, and says so on
screen. Memory is counted in entries rather than characters, because only a
page of it is loaded and a character total over a partial read would be wrong
in a way the number would not reveal.

## The models capability

`agents.model_id` is a foreign key into `models`, and `POST`/`PATCH /agents`
rejects any value that is not a real row with a 422 `MODEL_NOT_FOUND`.
`/api/v1/models` returns 404. **No agent can currently be given a model.**

`core/platform/capabilities.service.ts` probes `/models` once at startup, and
the UI adapts rather than blaming the user for a backend module that has not
shipped:

- readiness ignores the missing model and judges only what the user controls;
- the configuration meter excludes it, so 100% is reachable;
- the model field is disabled with the reason stated in place, instead of
  letting the user discover it by failing to save.

Only a definitive 404 counts as a completed probe — an unreachable API says
nothing about the capability. **When the providers and models endpoints ship,
delete nothing: the probe starts returning 200 and all three behaviours switch
back on their own.**

## Desktop shell

The app is built as a desktop product, not a web app in a window. Three things
carry that, and each one has a seam the frontend owns.

**The top bar is the title bar.** On macOS the window uses
`titleBarStyle: "Overlay"`, so the traffic lights sit inside the app's own bar
instead of in a strip of system chrome above it. `DesktopService.overlaysTitleBar`
reports when that is the case and the bar insets itself accordingly; Windows and
Linux keep their native frame and get no inset. The bar carries
`data-tauri-drag-region`, which applies to that element only — its empty areas
drag the window while the controls inside keep behaving as controls.

**The native menu asks, the shell performs.** Menu items emit
`glassbeetle://menu` with an action id; `DesktopService` forwards it and the
shell's `runMenuAction` carries it out. Nothing is implemented twice: "New
Agent" navigates to `/agents?new=1`, exactly as the rail's own button does, and
⌘K opens the same palette the keyboard binding does. Rust keeps only what a
webview cannot do — opening a URL in the system browser, and the native edit
and window commands. Adding a menu item means adding a case to `MenuAction` and
one to the switch; forgetting the second is a compile error.

The Edit menu matters more than it looks: without it ⌘C/⌘V/⌘A do nothing in the
webview's text fields, which is the single clearest way an app can feel like a
web page in a window.

**The window appears already painted.** It is created with `visible: false` and
revealed when the shell emits `glassbeetle://ready` after its first render,
because a webview shown before that is a white rectangle for a moment — very
visible against a dark workspace. Rust also reveals it unconditionally after a
few seconds: a window that waits on the frontend is only as reliable as the
frontend, and a window showing an error beats no window at all.

## Layout

```
src/app/
├── core/          Services with no UI: one per API resource, plus readiness,
│                  activity, capabilities, roster, theme, notifications.
│                  Nothing here imports a component.
├── shared/        `ui/` primitives (panel, skeleton, readiness badge),
│                  `styles/` mixins, list state, dialogs, pipes.
└── features/      One folder per surface, each lazily loaded by the router.
```

## Conventions

**Theme.** One `mat.theme()` with `theme-type: color-scheme`, then
`mat.theme-overrides()` swaps Material's generated neutrals for the product
palette in `src/styles/_palette.scss`. That is what stops this looking like a
default Material app, and it means no component restyles itself: everything
reads `--mat-sys-*`. Density is -2. Light and dark are one stylesheet; switching
flips `color-scheme` on `<html>`. Dark is the default.

**Surfaces.** `gb-panel` is the surface primitive — a hairline border and a flat
fill, not elevation. A screen shows several at once, and stacked elevated cards
read as a pile of documents rather than regions of one workspace.

**Screen layout.** `shared/styles/_view.scss` holds the `view`, `blank-state`,
`pill`, `toolbar`, `rows` and `tags` mixins. A new screen `@use`s those rather
than re-typing the idioms; that shared vocabulary is what keeps the surfaces
looking like one product.

**Loading.** Skeletons shaped like the result, not spinners: the layout does not
jump when the data lands.

**Talking to the API.** Every resource has a service extending `ApiClient`,
which holds the absolute base URL from `src/environments/` — a packaged Tauri
app is served from `tauri://localhost`, so a relative `/api` would resolve
against the custom protocol. Query parameters go through `toHttpParams`, which
drops `undefined`, `null` and empty strings: the API reads `?search=` as a
search for the empty string, not as the absence of a filter. The literal
`'null'` is preserved, because the agents endpoint uses it to select rows whose
foreign key is NULL.

**Errors.** `toApiError` normalises an `HttpErrorResponse` into the envelope
from [`docs/api-conventions.md`](../../docs/api-conventions.md). Status 0 means
the request never got a response, reported as "the API is unreachable" rather
than as whatever empty body came back. Validation failures carry one `details`
entry per failing constraint and a generic `message`, so `describeApiError`
shows the details.

**Patching.** A PATCH body carries only the fields that changed. An omitted key
leaves the column alone, an explicit `null` clears it, and `""` would store an
empty string the API then reports as set — so a cleared field is sent as `null`,
never `""`. An unchanged form sends nothing, which the API treats as a no-op and
which keeps `updated_at` honest.

**Lists.** Paging, sorting and debounced search live in `ListState`, which every
collection instantiates as a component field. Requests go through `switchMap`,
so a slow page-1 response cannot land after a fast page-2 one. Deleting the last
row on a page steps back rather than leaving an empty one. `resource()` and
`rxResource()` would cover some of this but are still experimental in Angular 21.

**Offline assets.** The icon font is bundled (`material-symbols`) and the
typography uses the platform UI font. A packaged Tauri app cannot rely on
reaching the Google Fonts CDN.
