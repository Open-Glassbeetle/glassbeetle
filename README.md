# Glassbeetle

A NestJS backend, an Angular frontend, and a Tauri desktop shell in one npm
workspace — all three start with a single command.

```bash
npm install
npm run dev
```

`npm run dev` boots the API, boots the Angular dev server, waits until both
answer, then opens the Tauri window. Closing the window shuts the other two
down.

## Layout

```
glassbeetle/
├── apps/
│   ├── api/                  NestJS 12 backend  → http://localhost:3000/api/v1
│   ├── web/                  Angular 21 frontend → http://localhost:4200
│   └── desktop/src-tauri/    Tauri 2 shell (Rust)
└── package.json              npm workspaces + orchestration scripts
```

The three tiers talk to each other like this:

- The Tauri window loads `http://localhost:4200` in development, and the
  prebuilt Angular bundle (`apps/web/dist/web/browser`) in a packaged build.
- Angular calls the API at `http://localhost:3000/api/v1`, configured in
  `apps/web/src/environments/`. The URL is absolute on purpose: a packaged
  Tauri app is served from `tauri://localhost`, so a relative `/api` would
  resolve against the custom protocol instead of the NestJS server.
- NestJS allows exactly three CORS origins — the dev server, the macOS/Linux
  webview (`tauri://localhost`) and the Windows webview
  (`http://tauri.localhost`). The API binds to `127.0.0.1` and has no
  authentication, so the allowlist is what stops any website the user visits
  from reading their data over `localhost`. Override it with
  `GLASSBEETLE_CORS_ORIGINS` if you run the frontend on a different port.
- Angular can also call into Rust directly — `apps/desktop/src-tauri/src/lib.rs`
  exposes a `greet` command, invoked from the app shell as a working example.

## Scripts

| Command                  | What it does                                              |
| ------------------------ | --------------------------------------------------------- |
| `npm run dev`            | API + Angular + Tauri window (the one command)             |
| `npm start`              | Alias for `npm run dev`                                    |
| `npm run dev:api`        | Just the NestJS API, in watch mode                         |
| `npm run dev:web`        | Just the Angular dev server                                |
| `npm run build`          | Compile the API and build the Angular bundle               |
| `npm run build:desktop`  | Build the API, then bundle the installable desktop app     |
| `npm test`               | Run the API and frontend unit tests                        |
| `npm run test:e2e -w @glassbeetle/api` | Run the API end-to-end tests                 |
| `npm run openapi:export -w @glassbeetle/api` | Write the OpenAPI spec to a file       |
| `npm run clean`          | Remove `dist/` output and the Rust `target/` directory      |

## API

The API is served under `/api/v1` and is documented with OpenAPI:

- interactive docs — <http://localhost:3000/api/docs>
- raw document — <http://localhost:3000/api/docs-json>, or `npm run openapi:export -w @glassbeetle/api`

Conventions every endpoint follows — routing, resource representation,
validation, the error envelope, configuration and security boundaries — are
documented in [`docs/api-conventions.md`](docs/api-conventions.md). Read it
before adding an endpoint.

### Configuration

Every setting is optional; the API starts with per-user defaults and does not
require a `.env` file. See [`apps/api/.env.example`](apps/api/.env.example) for
the full list.

Application data (the SQLite database, uploaded files, artifacts and backups)
lives outside the repository, in a per-user directory:

| Platform | Default data directory |
| -------- | ---------------------- |
| macOS    | `~/Library/Application Support/Glassbeetle` |
| Windows  | `%APPDATA%\Glassbeetle` |
| Linux    | `$XDG_DATA_HOME/glassbeetle`, else `~/.local/share/glassbeetle` |

Override it with `GLASSBEETLE_DATA_DIR` (absolute paths only).

## Requirements

- Node.js ≥ 20.19 (see the note below about newer Angular)
- Rust toolchain (`rustup`), plus the platform prerequisites for Tauri 2 —
  Xcode Command Line Tools on macOS

## Packaging note

`npm run build:desktop` produces an installable app, but the bundle contains
only the frontend and the Rust shell — it does not embed the NestJS server. A
packaged build expects the API to already be running on port 3000. To ship the
backend inside the installer, compile it to a binary and register it as a
[Tauri sidecar](https://v2.tauri.app/develop/sidecar/).

## Toolchain notes

Two things on this machine are pinned by the installed Node version (24.2.0):

- **Angular is on 21, not 22.** Angular 22 requires Node `^22.22.3 || ^24.15.0`.
  Upgrading Node to a current release lets you `ng update` to 22.
- **`package-lock.json` was generated with a newer npm.** npm 11.3.0 (the
  version bundled with Node 24.2.0) crashes with
  `Cannot read properties of null (reading 'edgesOut')` while resolving
  Vitest's peer graph from scratch. Installing from the committed lockfile
  works fine. If you ever need to regenerate it before upgrading Node, use
  `npx npm@latest install`.

Upgrading Node to a current LTS resolves both.
