# Contributing to Glassbeetle

Thanks for being here. Glassbeetle is an early project with a deliberately
sliced backlog, which means there is a lot of genuinely self-contained work
available — and you do not have to read the whole codebase to pick a piece of
it up.

This document is the part the [README](README.md) does not cover: how to get
set up, how to run only the piece you are working on, what the conventions
are, and what a pull request that is easy to merge looks like.

If something here is wrong, out of date, or confusing, that is a bug in this
file. Say so in an issue, or fix it — being new to the repository is an
advantage, because the things that confused you are exactly the things worth
writing down.

**You do not need permission to start.** Comment on an issue, open a draft PR,
or ask a question. Half-finished work with a question attached is welcome.

---

## Table of contents

- [Ways to contribute](#ways-to-contribute)
- [Where to start](#where-to-start)
- [Get it running](#get-it-running)
- [The fast development loop](#the-fast-development-loop)
- [When the first run goes wrong](#when-the-first-run-goes-wrong)
- [Architecture at a glance](#architecture-at-a-glance)
- [Toolchain surprises worth knowing](#toolchain-surprises-worth-knowing)
- [Tests, lint and formatting](#tests-lint-and-formatting)
- [Adding an API endpoint](#adding-an-api-endpoint)
- [Adding a frontend screen](#adding-a-frontend-screen)
- [Claiming an issue](#claiming-an-issue)
- [Branches and commit messages](#branches-and-commit-messages)
- [Opening a pull request](#opening-a-pull-request)
- [What review looks at](#what-review-looks-at)
- [Conventions that are not decided yet](#conventions-that-are-not-decided-yet)
- [Getting help](#getting-help)
- [Licence and conduct](#licence-and-conduct)

---

## Ways to contribute

Code is one of several, and not the one we are shortest on:

- **Implement a backlog issue.** Most open issues name a single endpoint or a
  single screen, with acceptance criteria already written.
- **Write tests.** Several areas have an integration test suite as their own
  issue — see the [`type:test`][label-test] label. The harness already exists,
  so these are mostly about knowing what should be true.
- **Improve the docs.** `docs/` explains conventions, not features. Anything
  you had to work out by reading source is a gap.
- **Report a bug.** A clear reproduction is worth more than a guess at the
  cause.
- **Review a pull request.** You do not need commit rights to leave a useful
  review.
- **Question a convention.** `docs/api-conventions.md` says it outright:
  changing a convention once is cheap, reconciling twenty endpoints that each
  chose differently is not. Early objections are a gift.
- **Design work.** Issues labelled [`type:design`][label-design] are RFCs
  looking for a proposal, not an implementation.

## Where to start

Three entry points, roughly in order of how much context they need:

1. **[`good first issue`][label-good-first]** — scoped so that you can finish
   them without knowing the rest of the codebase.
2. **[`type:test`][label-test]** — an existing feature, a documented harness,
   and a list of behaviours to pin down. A good way to learn an area by
   reading it.
3. **[`help wanted`][label-help]** — anything the maintainers would be glad to
   hand over.

Issues are also labelled by area (`area:agents`, `area:chat`,
`area:providers`, …) and by kind (`type:feature`, `type:refactor`,
`type:security`, …), so you can filter for the part of the stack you enjoy.

A note on how the backlog is shaped: the database schema in `data/` describes a
much larger product than the API currently serves. Many modules exist as empty
NestJS controllers whose routes 404. That is intentional — each one is an issue
waiting to be picked up, not an oversight. Expect to be implementing something
the schema already anticipates.

## Get it running

**Prerequisites**

| What | Why |
| --- | --- |
| Node.js ≥ 20.19 | API and frontend. See the [toolchain notes](README.md#toolchain-notes) before picking a version. |
| A Rust toolchain ([`rustup`](https://rustup.rs)) | Only for the Tauri desktop shell. |
| Tauri 2 platform prerequisites | [Tauri's prerequisites page](https://v2.tauri.app/start/prerequisites/). On macOS this is the Xcode Command Line Tools. |

You can contribute to the API or the frontend **without Rust or Tauri at all**
— see the next section. Install them when you need to touch the window itself.

**Setup**

```bash
git clone https://github.com/Open-Glassbeetle/glassbeetle.git
cd glassbeetle
npm install
npm run dev
```

`npm install` installs all three workspaces from the committed lockfile.
`npm run dev` boots the API, boots the Angular dev server, waits until both
answer, and then opens the Tauri window. Closing the window shuts the other two
down.

There is nothing else to configure. The API needs no `.env` file, has no
authentication, and creates its SQLite database on first boot in a per-user
data directory — **outside the repository**, so your work never touches a
checked-in database. See
[Configuration](README.md#configuration) for the paths and
[`apps/api/.env.example`](apps/api/.env.example) for every setting you *could*
override.

## The fast development loop

Booting the desktop shell compiles Rust. You usually do not need it:

```bash
npm run dev:api    # NestJS on :3000, watch mode
npm run dev:web    # Angular on :4200, watch mode
```

Run the two in separate terminals and work in a normal browser at
<http://localhost:4200>. The frontend talks to the API over HTTP either way,
and the dev server is an allowed CORS origin, so everything except the native
window and the native menu behaves identically.

Use `npm run dev` when your change touches
`apps/desktop/src-tauri/`, window chrome, the native menu, or anything that
goes through the `glassbeetle://` events described in the
[README](README.md#layout).

While the API is up, these are the two most useful URLs:

- <http://localhost:3000/api/docs> — interactive OpenAPI docs for every
  implemented endpoint
- <http://localhost:3000/api/v1/health> — the one endpoint that always exists

## When the first run goes wrong

**`EADDRINUSE` on 3000 or 4200.** A crashed terminal left a server holding its
port. `npm run stop` finds whatever is listening on both ports, stops the
watchers as well as the servers so nothing restarts itself, and leaves your
other projects alone:

```bash
npm run stop
npm run stop -- --dry-run    # show what would be stopped, kill nothing
API_PORT=3001 npm run stop   # non-default ports
```

**`npm install` crashes with `Cannot read properties of null (reading
'edgesOut')`.** That is npm 11.3.0 choking on Vitest's peer graph. Installing
from the committed lockfile works; see
[Toolchain notes](README.md#toolchain-notes). Don't regenerate the lockfile as
a side effect of another change.

**The Tauri window never appears.** `npm run dev` waits up to three minutes for
both servers before it launches the shell, and a first-time Rust build can take
longer than that on its own. Check that both dev servers actually came up, then
try again — the second build is cached.

**Angular wants a newer Node.** Angular is pinned to 21 because 22 requires a
newer Node than the project's floor. Don't bump it as part of an unrelated PR.

If none of that is it, open an issue. A first-run failure is a bug in this
document.

## Architecture at a glance

Three tiers and a schema directory:

```
glassbeetle/
├── apps/
│   ├── api/                  NestJS 12 — the only thing that touches SQLite
│   ├── web/                  Angular 21 — talks to the API over HTTP only
│   └── desktop/src-tauri/    Tauri 2 (Rust) — the window, the native menu
├── data/                     The SQL schema, one file per table
├── docs/                     Conventions and design records
└── scripts/                  Repository tooling (npm run stop)
```

Four things that are not obvious from the directory listing:

**The API owns the database, exclusively.** Nothing else opens the SQLite
file — not the frontend, not the Rust shell. If the frontend needs data, the
answer is an endpoint, never a second reader. The database lives outside the
repository in a per-user directory.

**`data/` is the schema, and it is executed, not documented.** Each file is the
`CREATE TABLE` (or index) for one table.
[`apps/api/src/database/schema-migrations.ts`](apps/api/src/database/schema-migrations.ts)
holds `MIGRATION_FILE_SEQUENCE`, an explicitly ordered list of those files —
ordered by foreign-key dependency, which is why it is a list and not a
directory scan. Adding a table means adding the SQL file *and* its entry in
that sequence. A table that already exists in a user's database needs an
incremental migration rather than an edit to the bootstrap file; the rules are
written down in [`docs/user-profile.md`](docs/user-profile.md), which is where
that path was first established.

**Rust and Angular talk through events, not commands.** The native menu emits
`glassbeetle://menu` with an action id; the Angular shell carries it out and
emits `glassbeetle://ready` once it has painted, which is what makes the window
appear. See
[`apps/desktop/src-tauri/src/menu.rs`](apps/desktop/src-tauri/src/menu.rs).

**The CORS allowlist is the security boundary.** The API binds to `127.0.0.1`
and has no authentication, so the three allowed origins — the dev server, the
macOS/Linux webview, the Windows webview — are the only thing stopping a
website the user visits from reading their data over `localhost`. Do not widen
it for convenience; `GLASSBEETLE_CORS_ORIGINS` exists for local experiments.

Read these before writing code in either app — both are short, and both exist
so you do not have to reverse-engineer a convention from a neighbouring
module:

- [`docs/api-conventions.md`](docs/api-conventions.md) — routing, resource
  representation, validation, the error envelope, configuration, security
- [`apps/web/README.md`](apps/web/README.md) — frontend structure, the
  capability probe, and the rule about not inventing data the API cannot back

The rest of `docs/` covers [logging](docs/logging.md),
[testing](docs/testing.md), [memory tags](docs/memory-tags.md),
[the realtime transport](docs/realtime-transport.md),
[the spending budget](docs/spend-budget.md) and
[the user profile](docs/user-profile.md).

## Toolchain surprises worth knowing

`apps/api` is a NestJS project that makes four unusual choices. Each one will
waste your time if you reach for the conventional tool instead:

| Expectation | Reality |
| --- | --- |
| CommonJS | **ESM.** `"type": "module"`, `module: nodenext`. |
| ESLint | **[oxlint](https://oxc.rs)** — `npm run lint -w @glassbeetle/api`. There is no `eslint --fix`. |
| Jest | **[Vitest](https://vitest.dev)** — no `jest.mock()`, no `jest.fn()`. Use `vi.*`. |
| `import './thing'` | **`import './thing.js'`** — the `.js` suffix is required. |

On that last one: because the API is ESM with `module: nodenext`, every
relative import needs the compiled `.js` extension even though the file on disk
is `.ts`. All 500-odd relative imports in `apps/api/src` follow this, so there
is nothing to decide — just don't let your editor's auto-import drop the
suffix.

Formatting is Prettier, configured per workspace (`apps/api/.prettierrc` and
`apps/web/.prettierrc`). There is no root script:

```bash
npm run format -w @glassbeetle/api     # writes
npx prettier --write "apps/web/src/**/*.{ts,html,scss}"
```

`apps/web/.editorconfig` covers the basics for editors that read it. oxlint's
rules live in `apps/api/oxlint.json`.

## Tests, lint and formatting

```bash
npm test                                  # API + frontend unit tests
npm run test -w @glassbeetle/api          # API unit tests only
npm run test:watch -w @glassbeetle/api    # …in watch mode
npm run test:e2e -w @glassbeetle/api      # API integration tests
npm run lint -w @glassbeetle/api          # oxlint
npm run build                             # type-check both apps the way CI does
```

[CI](.github/workflows/ci.yml) runs lint, build, unit tests and e2e tests on
every pull request. Running `npm run lint -w @glassbeetle/api`, `npm test` and
`npm run build` locally catches essentially everything it would.

Two suites, split by filename:

| Pattern | What it is |
| --- | --- |
| `src/**/*.spec.ts` | Unit tests — services, DTOs, isolated logic |
| `test/**/*.e2e-spec.ts` | Integration tests — real HTTP against a real, isolated database |

The integration harness in `apps/api/test/harness/` boots the application with
the exact production pipeline, points the database at a throwaway file in your
system temp directory (so it *cannot* touch your real data), enforces foreign
keys, resets between tests in under 2 ms, and gives you typed fixture builders.
[`docs/testing.md`](docs/testing.md) has a worked example — start from that
rather than from scratch.

**What we actually expect.** New endpoints come with integration tests; new
logic with a unit test; bug fixes with a test that fails before the fix. If you
are not sure what to test, open the PR anyway and ask — "I don't know how to
test this" is a reasonable thing to say, and a worse outcome is an untested
change nobody mentioned.

Frontend tests run through `ng test`, which in Angular 21 is Vitest as well —
no browser or Karma setup needed.

Lint currently reports one pre-existing warning in
`test/agents.e2e-spec.ts`. If you see exactly that one, it is not yours.

## Adding an API endpoint

Read [`docs/api-conventions.md`](docs/api-conventions.md) first — it is the
contract, and this is only the sequence.

Every module follows the same shape, so copy the nearest implemented one
(`user/`, `agents/`, `teams/`, `budget/` and `system-prompts/` are all live):

```
apps/api/src/modules/<area>/
├── <area>.controller.ts        routes, OpenAPI annotations
├── <area>.service.ts           the logic, and the SQL
├── <area>.module.ts            wiring
├── dto/                        request and response shapes
├── <area>.service.spec.ts      unit tests
├── <area>.controller.spec.ts   unit tests
└── <area>.openapi.spec.ts      asserts the documented contract
```

1. **Check the schema.** `data/` very likely already has your table. If it does
   not, add the SQL file and register it in `MIGRATION_FILE_SEQUENCE`.
2. **Find the module.** Most of them already exist as empty controllers
   waiting for exactly this.
3. **Write the DTOs**, with `class-validator` decorators. Validation happens at
   the global pipe, not in your service.
4. **Implement the service**, then the controller. SQL stays in the service;
   the controller does routing and documentation, not queries.
5. **Scope nested resources in the query.** Ids are globally unique, so
   `WHERE id = ?` alone would return another agent's private memory through a
   URL naming the wrong agent. Always `WHERE id = ? AND agent_id = ?`. This is
   the single easiest mistake to make in this codebase, and we treat it as a
   security bug — see [SECURITY.md](SECURITY.md).
6. **Annotate for OpenAPI** so the endpoint appears at `/api/docs`, and add to
   the module's `*.openapi.spec.ts`. The documented contract is tested, which
   is what keeps `/api/docs` honest.
7. **Write the integration test** against the harness.
8. **Update the docs** if you established or changed a convention, and
   `apps/web/README.md`'s surface table if the frontend can now show something.

## Adding a frontend screen

Read [`apps/web/README.md`](apps/web/README.md) first — specifically the part
about what the UI deliberately does not invent.

Screens live in `apps/web/src/app/features/<area>/`, shared services in
`core/`, reusable components in `shared/`. The one rule that is unusual enough
to repeat here: **do not render data the API cannot back.** Where the schema
promises more than the API serves, the UI says so on screen rather than
mocking it — agents show configuration readiness instead of an invented run
state, the spending screen states that nothing writes `usage_events` yet, and
model assignment is disabled with its reason given. A plausible-looking
placeholder is worse than an honest empty state, because it cannot be told
apart from a working feature.

## Claiming an issue

Comment on it. That's it — no assignment ceremony, no form.

If an issue has been assigned or claimed and the comment is old and nothing has
moved, ask whether it is still being worked on before you start. If you claimed
something and life happened, just say so; handing it back is normal and nobody
will mind.

For anything larger than an issue — a new convention, a refactor across
modules, a dependency — open an issue first and sketch the approach. Not for
approval, but so you do not write something that collides with a design
decision you had no way of knowing about.

## Branches and commit messages

Work on a branch. External contributors: fork, branch, PR.

```
feat/team-chat-orchestration
fix/spend-meter-visibility
docs/contributing-guide
test/memory-integration
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org):

```
<type>(<scope>): <what changed, lower case, no trailing period>
```

Types in use: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `chore`.
Scopes are the workspace or the area — `api`, `web`, `desktop`, `memory`.

```
feat(api): serve the spending budget at /api/v1/budget
fix(web): show the budget in the deck before one is set
refactor(api): share the LIKE pattern escaper
docs: record teams as an implemented surface
```

Write the subject as what the change does, not what you did. Nothing is
enforced by a hook, so this is a convention rather than a gate — but a readable
`git log` is one of the reasons this backlog can be sliced the way it is.

Multi-part work is easier to review as several commits than as one: schema,
then API, then frontend, then docs. Look at
[the teams PR](https://github.com/Open-Glassbeetle/glassbeetle/pull/101) for
the shape.

## Opening a pull request

Fill in the template — it asks what changed, why, and how you tested it. Then:

- **Keep it scoped.** One issue per PR where you can. If you fixed something
  unrelated on the way, say so in the description, or split it out.
- **Link the issue.** `Closes #42`.
- **Say what you did not do.** A PR that implements four of five acceptance
  criteria and names the fifth is easy to merge. One that silently skips it is
  not.
- **Open it as a draft when it isn't ready.** Draft PRs are a good way to ask
  a question with code attached, and reviewers will not nitpick a draft.
- **Expect comments, including on small things.** They are about the code, not
  about you, and "I'd rather not, because…" is a valid answer to any of them.

Your first PR will have the CI workflow approved by a maintainer before it
runs; that is a GitHub default for new contributors, not a comment on your
change.

By opening a pull request you agree that your contribution is licensed under
the repository's [MIT licence](LICENSE).

## What review looks at

In roughly this order:

1. **Does it do what the issue asked?** Including the acceptance criteria.
2. **Does it follow the conventions?** Routing, error envelope, resource
   representation, parent-scoped queries. Those are in
   `docs/api-conventions.md` so that review does not have to be the place you
   find out about them.
3. **Is it tested?** See above.
4. **Does it claim more than it can deliver?** This matters more here than in
   most projects. The UI's honesty about what the API cannot do yet is a design
   property, not an accident, and the same applies to the API's own responses.
5. **Is lint and build clean?** CI will tell you.
6. **Are the docs still true?** If behaviour changed, something in `docs/`,
   `README.md` or `apps/web/README.md` probably needs a line.

What review does *not* do: bikeshed formatting (Prettier decides), or expect
you to have solved an adjacent problem you did not sign up for.

## Conventions that are not decided yet

Some things genuinely have no answer yet, and several open design issues will
each write their own. If your change runs into one, do not invent an answer
quietly — follow the nearest existing implementation, say in the PR that you
did, and link the design issue so the decision lands in one place:

- **Pagination shape, DTO conventions, the error contract** — partly settled in
  `docs/api-conventions.md`; anything it does not cover is still open.
- **Semantic memory, retrieval and context injection** — see the RFC issue
  under [`area:memory`][label-memory].
- **Multi-agent team chat orchestration** — see the RFC issue under
  [`area:chat`][label-chat].
- **Provider error normalization and the model adapter interface** — see
  [`area:providers`][label-providers].
- **Artifact versioning and content lifecycle** — see
  [`area:artifacts`][label-artifacts].
- **Usage events.** Nothing writes them yet, which is why the spending screen
  reads zero everywhere. Whoever implements inference will establish how they
  are recorded.

## Getting help

- **A question about the project or a piece of code** — open an issue with the
  `question` label. There are no stupid ones, and an answer usually ends up in
  `docs/`, which makes the question useful to the next person.
- **Stuck inside a change** — open a draft PR and ask there. Code in front of
  the question saves a round trip.
- **Something that should not be public** — see [SECURITY.md](SECURITY.md).

Response times are best-effort; this is a small project. If something sits for
a week, a polite nudge is welcome rather than rude.

## Licence and conduct

Glassbeetle is [MIT licensed](LICENSE), and contributions are accepted under
the same terms.

Everyone taking part is covered by the
[Code of Conduct](CODE_OF_CONDUCT.md). It exists so that the welcome at the top
of this file is something you can rely on rather than just a sentence.

[label-good-first]: https://github.com/Open-Glassbeetle/glassbeetle/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22
[label-help]: https://github.com/Open-Glassbeetle/glassbeetle/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22
[label-test]: https://github.com/Open-Glassbeetle/glassbeetle/issues?q=is%3Aissue+is%3Aopen+label%3Atype%3Atest
[label-design]: https://github.com/Open-Glassbeetle/glassbeetle/issues?q=is%3Aissue+is%3Aopen+label%3Atype%3Adesign
[label-memory]: https://github.com/Open-Glassbeetle/glassbeetle/issues?q=is%3Aissue+is%3Aopen+label%3Aarea%3Amemory
[label-chat]: https://github.com/Open-Glassbeetle/glassbeetle/issues?q=is%3Aissue+is%3Aopen+label%3Aarea%3Achat
[label-providers]: https://github.com/Open-Glassbeetle/glassbeetle/issues?q=is%3Aissue+is%3Aopen+label%3Aarea%3Aproviders
[label-artifacts]: https://github.com/Open-Glassbeetle/glassbeetle/issues?q=is%3Aissue+is%3Aopen+label%3Aarea%3Aartifacts
