# Testing Guide & Integration Test Harness

This document describes the testing strategy and the shared integration test harness for the Glassbeetle API (`@glassbeetle/api`).

## Test File Naming Conventions

Vitest runs two distinct test suites based on file naming patterns:

| File Pattern | Category | Purpose | Command |
|---|---|---|---|
| `**/*.spec.ts` | Unit Tests | Tests isolated components, services, and DTOs in `src/`. | `npm test` |
| `**/*.e2e-spec.ts` | Integration / E2E Tests | Tests full HTTP endpoints against a real isolated database in `test/`. | `npm run test:e2e -w @glassbeetle/api` |

---

## Integration Test Harness Overview

Every HTTP-level integration test should use the test harness provided in [`apps/api/test/harness/index.ts`](file:///c:/Users/N.Schmid.inf24/Documents/GIT_LOCAL/OGB/glassbeetle/apps/api/test/harness/index.ts).

### Key Features
1. **Production Request Pipeline**: Boots the NestJS application with the exact global configuration used in production (`configureApp` and `registerNotFoundFallback`), exercising validation pipes, versioning, exception filters, and middleware.
2. **Database Isolation & Safety**: Points `DatabaseService` at a temporary, isolated SQLite database file created in the system temp directory (`tmpdir()`). It is impossible to run tests against the user's real data directory.
3. **Foreign Key Enforcement**: `PRAGMA foreign_keys = ON` is strictly enforced.
4. **Fast Reset Helper**: `testApp.reset()` truncates all user tables in `< 2ms` between tests so the application does not need to be re-booted between individual test cases.
5. **Typed Fixture Builders**: `testApp.fixtures` provides typed builder methods for all core domain entities with sensible defaults and relational auto-wiring.

---

## Worked Example: Writing an Endpoint Integration Test

Create a new file with the `.e2e-spec.ts` extension under `apps/api/test/` (e.g., `agents.e2e-spec.ts`).

```typescript
import { createTestApp, TestApp } from './harness/index.js';

describe('Agents Endpoint (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(() => {
    testApp.reset();
  });

  it('GET /api/v1/agents - returns a list of agents', async () => {
    // Seed fixtures using the typed builder
    const agent = testApp.fixtures.createAgent({ name: 'Coder Agent' });

    const res = await testApp
      .request()
      .get('/api/v1/agents')
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(agent.id);
    expect(res.body.items[0].name).toBe('Coder Agent');
  });

  it('POST /api/v1/agents - creates a new agent', async () => {
    const model = testApp.fixtures.createModel();

    const payload = {
      name: 'New Agent',
      model_id: model.id,
      temperature: 0.8,
    };

    const res = await testApp
      .request()
      .post('/api/v1/agents')
      .send(payload)
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('New Agent');
  });
});
```

---

## Available Fixture Builders (`testApp.fixtures`)

The `TestFixtures` class provides builder helpers for all 10 core entities. Calling a builder inserts the record into SQLite and returns the inserted row object.

- `createSystemPrompt(overrides?)`
- `createProvider(overrides?)`
- `createModel(overrides?)` *(Auto-creates a provider if `provider_id` is omitted)*
- `createAgent(overrides?)`
- `createTeam(overrides?)`
- `createTeamMember(teamId?, agentId?, overrides?)` *(Auto-creates team and agent if omitted)*
- `createProject(overrides?)`
- `createChat(overrides?)` *(Auto-creates an agent if neither `agent_id` nor `team_id` is provided, satisfying DB constraints)*
- `createMessage(overrides?)` *(Auto-creates a chat if `chat_id` is omitted)*
- `createArtifact(overrides?)`
- `createAgentMemory(overrides?)` *(Auto-creates an agent if `agent_id` is omitted)*
- `createSharedMemory(overrides?)`

---

## Running Tests

```bash
# Run unit tests
npm test

# Run API integration tests
npm run test:e2e -w @glassbeetle/api
```
