# Code comments

How the backend is documented in its own source, and how to render that as a
browsable API reference.

The short version: write the *why*, let the code say the *what*, and never
write a comment the implementation does not support.

## TSDoc, and where it goes

Doc comments are TSDoc (`/** ... */`) and sit on the declaration they describe.
Every exported class, function, interface, type and constant in `apps/api/src`
carries one, as do private members whose behaviour is not obvious from the
code.

What a comment is for:

- **Why the thing exists**, and what it is responsible for. A name that already
  says what a function does does not need a sentence repeating it.
- **The contract**: what the caller must guarantee, what it gets back, and what
  happens when the input is wrong.
- **Non-obvious behaviour**: an invariant, an ordering requirement, a
  deliberate idempotency, a deliberate *non*-idempotency, a fallback that
  degrades rather than throwing.
- **The decision**, where one was made. "Deny by omitting the header rather
  than by erroring" is worth a sentence; a reader who does not know why will
  eventually change it back.

Prose carries most of that. Tags are used where they add something the prose
does not:

| Tag | Use it for |
| --- | --- |
| `@param` | A parameter whose meaning or constraints are not evident from its name and type. Not for all of them, and not for `id: string`. |
| `@returns` | A return value with a case worth naming — `null` for "not found", a count, a value the caller must interpret. |
| `@throws` | Every exception a caller can reasonably handle, with its HTTP status and its stable `code`. This is the one tag to be thorough with: the error envelope is part of the API contract. |
| `@see` | A document under `docs/`, or the counterpart that explains the other half of a rule. |
| `@remarks`, `@example`, `@deprecated` | When they genuinely apply. Do not invent an example for a two-line function. |

Do not add a tag that restates the signature. A `@param dto - The DTO` is
noise, and noise is what makes contributors stop reading doc comments.

## What lives in decorators instead

**DTO field meanings belong in `@ApiProperty({ description })`**, not in a doc
comment above the field. That description is what `/api/docs` and
`openapi.json` serve, so it is the one a client author reads; a TSDoc comment
beside it would be a second copy to keep in step. A DTO's class-level comment
is where the shape's *contract* goes — which fields are required, what an
explicit `null` means versus an omitted field, which server-managed fields are
rejected, and what an empty body does.

The same applies to controllers: `@ApiOperation({ description })` documents the
endpoint for its clients, and the handler's doc comment is for the contributor
— the route, what it delegates to, and whatever the endpoint does that the
client-facing text does not mention, such as setting a `Location` header or
binding a query DTO purely to make the global `ValidationPipe` enforce a
confirmation parameter.

## Accuracy rules

- **The implementation is the source of truth.** If a comment and the code
  disagree, the comment is the bug. Fix it in the same change.
- **Do not document behaviour that does not exist yet.** Several modules are
  placeholders — `inference`, `model-adapters`, `projects`, `artifacts`,
  `analytics`, `application`, and the provider credential and model
  sub-resources. Their comments say so, and name what is missing, rather than
  describing endpoints a reader would then look for.
- **Never put a secret in a comment.** No keys, no tokens, no credential
  values, and no absolute paths from a developer's machine.
- **Cascades are part of the contract.** A delete that cascades, sets a
  foreign key to null, or fails against a `CHECK` constraint says which, per
  referencing table. `data/` is the authority; keep the comment in step with it.

## Generating the reference site

TypeDoc renders these comments into a browsable HTML reference:

```bash
npm run docs:api
```

The site is written to `apps/api/docs-site/`; open its `index.html`. The
directory is generated and gitignored, and `npm run clean` removes it.

Configuration lives in [`apps/api/typedoc.json`](../apps/api/typedoc.json).
Three of its settings are decisions rather than defaults:

- **`excludePrivate: false`.** The audience is contributors, not consumers of a
  published package, so a private method's reasoning is exactly what they need.
  It also means a `{@link}` to a private member resolves instead of warning.
- **`skipErrorChecking: true`.** TypeDoc would otherwise run the whole
  typecheck a second time. `npm run build` already does that, and a documented
  build is not the place to discover a type error.
- **`validation.invalidLink` and `validation.notExported`** are on, so a
  `{@link}` pointing at something that is not in the documentation is reported.
  `notDocumented` is off: it counts a DTO field as undocumented even though its
  meaning lives in `@ApiProperty`, which would bury the real findings.

A clean run reports `Found 0 errors and 0 warnings`. Warnings are worth fixing
rather than tolerating — they are nearly always a link to a symbol that was
renamed or never imported.

## Checking it

There is no doc linter. The checks that apply are the ordinary ones, plus the
generator:

```bash
npm run lint -w @glassbeetle/api
```

```bash
npm run build -w @glassbeetle/api
```

```bash
npm run docs:api
```

A malformed doc comment is a syntax error, so `build` catches the structural
mistakes; TypeDoc catches broken references; the rest is review.

One consequence of the build setup is worth knowing: `tsconfig.json` sets
`removeComments: true`, so the emitted `dist/**/*.d.ts` files carry no doc
comments. Nothing consumes this package as a library, so that costs nothing
today — and TypeDoc reads the source rather than the build output, so the
reference site is unaffected.
