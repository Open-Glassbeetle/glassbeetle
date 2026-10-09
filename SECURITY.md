# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub instead:

> **[Open a private security advisory][report]**
> (repository → **Security** → **Advisories** → *Report a vulnerability*)

That form is visible only to the maintainers. If it is unavailable for any
reason, open a regular issue saying only that you have a security report and
asking for a private channel — no details — and a maintainer will come back to
you.

What helps, in rough order of usefulness: what an attacker can do, the smallest
way to reproduce it, and which version or commit you looked at. A report
without all three is still worth sending.

Expect an acknowledgement within a few days. This is a small project, so
please be patient rather than assume you were ignored; a nudge after a week is
welcome. We will tell you what we plan to do and when, and we are glad to
credit you in the advisory unless you would rather stay anonymous.

Good-faith security research is welcome here. We will not pursue or complain
about anyone who reports a problem responsibly through the channel above.

## Supported versions

Glassbeetle is pre-1.0 and under active development. Only the current `main`
branch receives fixes; there are no maintained release branches yet.

## The threat model, in short

Glassbeetle is a **local-first, single-user desktop application**. Knowing how
it is built will tell you whether something is a vulnerability or a documented
property:

- **The API has no authentication, by design.** It binds to `127.0.0.1` and
  serves one user — the person running it. "No auth on the endpoints" is not a
  finding on its own.
- **The CORS allowlist is the security boundary.** Because there is no auth,
  the three permitted origins — the Angular dev server, the macOS/Linux webview
  (`tauri://localhost`) and the Windows webview (`http://tauri.localhost`) —
  are what stop a website the user visits from reading their data over
  `localhost`. **Anything that widens, bypasses or reflects that allowlist is a
  real vulnerability.** So is anything that lets a remote page reach the API.
- **Parent scoping is a boundary, not a nicety.** Ids are globally unique, so a
  nested endpoint that reads a child by its own id alone would return another
  agent's private memory through a URL naming the wrong agent. A missing
  `AND agent_id = ?` is a security bug, and we treat it as one.
- **User data lives outside the repository**, in a per-user directory — the
  SQLite database, uploaded files, artifacts and backups. Path traversal,
  arbitrary file reads or writes, or anything escaping that directory are in
  scope. So is anything escaping it via `GLASSBEETLE_DATA_DIR`.
- **Provider credentials are stored locally** for the user's own API keys.
  Anything that discloses them over HTTP, writes them to a log, or includes
  them in an error response is in scope.
- **The desktop shell** loads the local Angular bundle. Anything that gets
  remote content, or arbitrary command execution, into that webview is in
  scope.

Out of scope: an attacker who already has the user's operating-system account
or filesystem access, missing authentication as such, and anything that
requires the user to deliberately disable a protection documented in
[`apps/api/.env.example`](apps/api/.env.example).

If you are unsure whether what you found counts — send it. Sorting that out is
our job, not yours.

[report]: https://github.com/Open-Glassbeetle/glassbeetle/security/advisories/new
