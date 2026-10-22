# Documentation

Start with the document for the work you are doing. The conventions below
describe current behaviour; the design records explain decisions; the proposal
describes work that has not shipped.

## Conventions

- [API conventions](api-conventions.md): Read before adding an endpoint to
  follow the routing, validation, response, and security rules.
- [Testing](testing.md): Read before writing an API integration test to use
  the isolated database harness and production request pipeline.
- [Logging](logging.md): Read when adding request diagnostics so correlation
  IDs, log levels, and secret redaction stay consistent.
- [Memory tags](memory-tags.md): Read when writing or filtering memories to
  preserve tag normalisation, storage, and query behaviour.
- [Code comments](code-comments.md): Read before documenting backend code to
  follow the TSDoc conventions and the division with the OpenAPI decorators,
  and to render the reference site with `npm run docs:api`.

## Design records

- [User profile](user-profile.md): Read when changing the profile or its
  consumers to understand why it is a single-user resource.
- [Spending budget](spend-budget.md): Read when changing budget reporting or
  its UI to see what is measured and what still has no usage data.
- [Realtime transport](realtime-transport.md): Read before implementing
  streaming to follow the accepted SSE design and its persistence rules.

## Proposals

- [Semantic memory](rfc-semantic-memory.md): Read before building retrieval
  or prompt injection; these approaches are proposed, not implemented.

When adding a document under `docs/`, add an entry here so readers can find it.
