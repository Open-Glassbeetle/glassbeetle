# RFC: Multi-Agent Team Chat Orchestration

**Status:** Proposed  
**Author:** Glassbeetle Core Team  
**Date:** November 2026  
**Issue:** [#67](https://github.com/Open-Glassbeetle/glassbeetle/issues/67)  
**Related Documents:** [`api-conventions.md`](api-conventions.md), [`realtime-transport.md`](realtime-transport.md), [`rfc-semantic-memory.md`](rfc-semantic-memory.md)  
**Related Schemas:** [`data/chats/chats.sql`](../data/chats/chats.sql), [`data/chats/messages.sql`](../data/chats/messages.sql), [`data/teams/teams.sql`](../data/teams/teams.sql), [`data/teams/team_members.sql`](../data/teams/team_members.sql)

---

## 1. Context & Motivation

Glassbeetle's database schema was built from day one to support collaborative multi-agent teams:

- A chat can be owned either by a single agent or by a team (`chats.team_id REFERENCES teams(id)`), enforced by an exclusive `CHECK` constraint in [`chats.sql`](../data/chats/chats.sql#L10-L13).
- Individual conversation messages record author attribution via `messages.agent_id REFERENCES agents(id) ON DELETE SET NULL` with the explicit schema annotation `"-- which Agent responded (relevant for Teams)"` in [`messages.sql`](../data/chats/messages.sql#L6).
- Team composition is persisted in `team_members` with `team_id`, `agent_id`, `role TEXT`, and `position INTEGER` columns.

However, the inference execution engine currently rejects completion and streaming requests for team chats with HTTP 422 `TEAM_CHAT_NOT_SUPPORTED`:

```typescript
if (chat.team_id !== null) {
  throw new UnprocessableEntityException({
    code: "TEAM_CHAT_NOT_SUPPORTED",
    message: "Multi-agent team chats are not yet supported for completion",
  });
}
```

The underlying blockers are architectural: **a team conversation has no single model, no single system prompt, and no natural single-turn completion loop**. When a user posts a message to a team chat, the runtime must answer seven fundamental questions:

1. **Turn-Taking**: Which agent responds, in what order, and who decides?
2. **Termination**: When does the multi-agent exchange finish?
3. **Context Visibility & Same-Role Alternation**: What does each agent see in the transcript, and how do we resolve the fact that major model providers (Anthropic, Google Gemini) strictly reject consecutive same-role turns?
4. **Per-Agent Heterogeneity**: How do we reconcile diverse models, system instructions, and provider credentials across agents within one conversation?
5. **Attribution & Invariants**: How are messages credited, and how do we handle deleted members?
6. **Streaming Protocol**: How does a single client connection stream successive responses from distinct agents?
7. **Failure Recovery**: What happens if an agent fails mid-turn?

This RFC provides concrete, actionable answers to each question and defines a pragmatic, small **Phase 1 shippable increment** that requires **zero schema migrations** while leaving an upgrade path for autonomous coordination.

---

## 2. Evaluation of Turn-Taking Strategies

How should the runtime decide which agent speaks when a user sends a message?

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          User Prompt Submitted                              │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
┌───────────────────────┐                             ┌───────────────────────┐
│ Strategy A: Pipeline  │                             │ Strategy B: Router    │
│ (Sequential / Order)  │                             │ (Coordinator Agent)   │
├───────────────────────┤                             ├───────────────────────┤
│ Agent 1 (Pos 1)       │                             │ Coordinator analyzes  │
│       ▼               │                             │       ▼               │
│ Agent 2 (Pos 2)       │                             │ Delegates to Specialist│
│       ▼               │                             │       ▼               │
│ Agent 3 (Pos 3)       │                             │ Synthesizes / Returns │
└───────────────────────┘                             └───────────────────────┘
```

### 2.1 The Options

| Strategy                                               | Predictability | Latency Overhead             | Token / Financial Cost                | Implementation Complexity | Primary Use Case                                         |
| :----------------------------------------------------- | :------------- | :--------------------------- | :------------------------------------ | :------------------------ | :------------------------------------------------------- |
| **1. Sequential Pipeline (Round-Robin by `position`)** | **Very High**  | **Lowest** (0 routing calls) | **Predictable** ($N$ calls per turn)  | **Low**                   | Structured workflows (e.g. Architect → Coder → Reviewer) |
| **2. Designated Coordinator (Router Agent)**           | Medium         | High (+1 triage model call)  | Variable ($1 + K$ calls)              | Medium                    | Open-ended helpdesks & intent dispatch                   |
| **3. Broadcast (Parallel / Independent)**              | High           | Low (concurrent calls)       | High (all agents run unconditionally) | Medium                    | Brainstorming, multi-perspective comparisons             |
| **4. Dynamic Autonomous Handoff**                      | Low            | High (eval calls + looping)  | Unbounded without hard caps           | Very High                 | Open-ended agent research teams                          |

---

### 2.2 Analysis

#### Strategy 1: Sequential Pipeline (Round-Robin by `position`)

- **Mechanism**: Agents in `team_members` are sorted by `position ASC`. When the user posts a turn, member 1 processes the context and responds, then member 2 sees member 1's reply and responds, continuing until the last member finishes.
- **Pros**:
  - **100% Deterministic & Predictable**: The user configures a pipeline (e.g., Position 1 = Drafter, Position 2 = Fact Checker, Position 3 = Proofreader). The user knows exactly who will speak and in what order.
  - **Direct Schema Alignment**: Directly uses `team_members.position` without new columns.
  - **Zero Routing Latency / Cost**: No extra LLM call is wasted deciding who speaks.
- **Cons**: Every configured member speaks, even if a user query only needed one specialist.

#### Strategy 2: Designated Coordinator (Router Agent)

- **Mechanism**: One member is marked as coordinator (via `team_members.role = 'coordinator'` or an explicit setting). The coordinator inspects the user message, assesses team members' capabilities, and delegates the turn to one or more specialists.
- **Pros**: Highly dynamic; routes simple questions to a single agent, saving unnecessary turns.
- **Cons**:
  - Adds a mandatory LLM round-trip before any visible token streams to the user.
  - Susceptible to routing hallucinations (dispatching to the wrong specialist).
  - Requires a structured tool-call or JSON routing schema from the coordinator model.

#### Strategy 3: Broadcast (All Agents Respond to User Turn)

- **Mechanism**: Every agent in the team receives the user prompt independently and replies concurrently.
- **Pros**: Fast parallel generation; excellent for contrasting opinions or multi-model benchmarking.
- **Cons**: Agents cannot see each other's work within the turn; produces disjointed monologues rather than true collaboration.

#### Strategy 4: Dynamic Autonomous Handoff (`NEXT: @AgentName`)

- **Mechanism**: Agents append structured handoff tokens (e.g., `[NEXT: Coder]` or `[DONE]`) to pass execution dynamically.
- **Pros**: Matches academic multi-agent frameworks (e.g. AutoGen, CrewAI).
- **Cons**:
  - High risk of infinite conversational loops or premature termination.
  - Prone to prompt injection and syntax drift across diverse local/hosted models.
  - Confusing user experience in a desktop application where the user expects clear, reliable execution.

---

### 2.3 Decision for Phase 1: Sequential Position Pipeline

**Glassbeetle adopts Strategy 1 (Sequential Pipeline by `team_members.position`) as the core orchestration foundation.**

1. **Ordering & Deterministic Tiebreakers**:

   ```sql
   SELECT tm.agent_id, tm.role, tm.position
   FROM team_members tm
   WHERE tm.team_id = ?
   ORDER BY
     tm.position ASC NULLS LAST,
     tm.created_at ASC,
     tm.agent_id ASC;
   ```
   - Members with explicit `position` values execute in ascending order (`1, 2, 3...`).
   - `NULL` positions execute after positioned members.
   - Tied positions are broken deterministically by membership creation timestamp (`created_at ASC`), followed by `agent_id ASC`.

2. **Degenerate Edge Cases**:
   - **1-Member Team**: Degenerates cleanly into a single-turn execution, identical in UX to single-agent chat while preserving `team_id` ownership and `messages.agent_id` attribution.
   - **0-Member Team** (or all members deleted): Rejected immediately with HTTP 422 `TEAM_HAS_NO_MEMBERS` before allocating any message sequence or model resources.
   - **Duplicate Members**: Prevented by the composite primary key `PRIMARY KEY (team_id, agent_id)` in `team_members.sql`.

---

## 3. Termination & Loop Prevention

In multi-agent systems, agents responding to each other can enter runaway execution loops, exhausting API rate limits and spend budgets.

### 3.1 Termination Invariants

1. **Single-Pass Pipeline Invariant (Phase 1)**:
   - A single user prompt triggers **exactly one pass** through the team membership list ($K$ agent responses for a team of $K$ active members).
   - Once the final position member produces a complete reply, the interaction is complete and the stream emits `[DONE]`.
   - Agents **do not** automatically trigger subsequent rounds without further user input.
2. **Hard Safety Bound (`max_turns_per_interaction`)**:
   - The runtime enforces a hard cap of $M$ agent turns per user interaction (default: $M = \min(\text{member\_count}, 10)$).
   - Even if dynamic handoffs or coordinator loops are added in Phase 2, this hard guardrail terminates execution if exceeded.
3. **Explicit Early Exit**:
   - If an agent generates an early completion token (e.g., `<!-- GB_TEAM_FINISH -->` or empty content denoting satisfaction), the pipeline terminates early without forcing downstream members to produce filler responses.
4. **Client Cancellation**:
   - The entire team sequence is bound to the incoming HTTP request's `AbortSignal`. If the user closes the browser window or clicks "Stop Generating", the in-flight provider call is aborted immediately, the current message row is finalized, and subsequent queued team members are skipped.

---

## 4. Context Visibility & The Consecutive Same-Role Problem

This is the central technical hurdle in multi-agent conversational AI.

### 4.1 The Conflict

In a single-agent chat, turns strictly alternate:
$$\text{User} \longrightarrow \text{Assistant} \longrightarrow \text{User} \longrightarrow \text{Assistant}$$

In a multi-agent team chat with 3 agents (e.g. Alice, Bob, Charlie), a single user prompt produces a run of consecutive assistant turns:
$$\text{User} \longrightarrow \text{Alice (Assistant)} \longrightarrow \text{Bob (Assistant)} \longrightarrow \text{Charlie (Assistant)}$$

When Charlie is called to generate, Charlie must see what Alice and Bob said. However:

- **Anthropic Claude API**: Strictly enforces role alternation (`user` followed by `assistant`). Passing two consecutive `assistant` turns causes an immediate HTTP 400 `invalid_request_error`.
- **Google Gemini API**: Strictly requires contents to alternate between role `user` and role `model`. Passing consecutive `model` turns causes HTTP 400 `Please ensure that multiturn requests alternate between user and model`.
- **OpenAI / Ollama / LM Studio**: Allow consecutive `assistant` turns, but attribution is ambiguous unless explicit formatting or `name` attributes are used.

### 4.2 Evaluated Context Presentation Strategies

```
Transcript in Database:
  Seq 1: User: "Design a cache."
  Seq 2: Alice: "Use Redis with LRU eviction."
  Seq 3: Bob: "Add a 5-minute TTL."
```

#### Approach A: Blind Isolation (User Turns Only)

- _Mechanism_: Bob and Charlie only see the user's prompt (`Seq 1`). They never see Alice's reply.
- _Verdict_: **Rejected.** Defeats the entire purpose of a team. Bob cannot review or refine Alice's cache design if Bob cannot read it.

#### Approach B: Naive Adapter Merging

- _Mechanism_: The adapter merges Alice and Bob's consecutive assistant messages into a single text block separated by `\n\n`.
- _Verdict_: **Rejected as a core solution.** From Charlie's perspective, Alice and Bob appear as a single anonymous assistant. Furthermore, it confuses the model into thinking _it_ previously generated Alice's remarks, causing persona bleed and self-contradiction.

#### Approach C: Perspective-Based Role Relabeling (Recommended)

- _Mechanism_: Roles are mapped **relative to the speaking agent**:
  - The human prompt is always `role: 'user'`.
  - Messages produced previously by the **current speaking agent** are `role: 'assistant'`.
  - Messages produced by **peer agents** are external inputs to the current agent. They are framed with clear, attributed participant banners.
- _Analysis_:
  To Agent Bob, Alice's recommendation is an **input** from a colleague, exactly like a user prompt or external observation.
  By formatting peer agent turns as structured input blocks, the conversation naturally satisfies strict provider alternation rules while preserving distinct identities.

---

### 4.3 Concrete Wire Protocol Mapping

For an interaction with:

- `Message 1` (Human): _"Plan a database migration."_
- `Message 2` (Alice - Architect): _"We should migrate from Postgres to SQLite using WAL mode."_
- Now generating: `Message 3` (Bob - Database Specialist).

#### 1. Outbound to OpenAI / OpenAI-Compatible / Ollama / LM Studio

These providers natively support consecutive assistant messages and provide a `name` field on messages:

```json
[
  { "role": "user", "content": "Plan a database migration." },
  { "role": "assistant", "name": "Alice", "content": "We should migrate from Postgres to SQLite using WAL mode." }
]
```

#### 2. Outbound to Anthropic (Claude) & Google Gemini

Anthropic and Gemini reject consecutive assistant turns. When Bob is generating, Alice's prior message is mapped as an attributed collaborative input turn (`role: 'user'`):

```json
[
  {
    "role": "user",
    "content": "Plan a database migration."
  },
  {
    "role": "assistant",
    "content": "I am standing by as the team collaborates."
  },
  {
    "role": "user",
    "content": "[Team Member: Alice (Role: Architect)]:\nWe should migrate from Postgres to SQLite using WAL mode.\n\nPlease review and proceed with your turn as Database Specialist."
  }
]
```

#### 3. Standardized Attributed Content Format (Provider-Agnostic Baseline)

To guarantee 100% interoperability across all existing adapters without requiring adapter-specific workarounds, Glassbeetle's context construction formats peer turns within the prompt stream:

$$\text{[Team Member: \{Name\} (\{Role\})]:}\n\{\text{Content}\}$$

When consecutive assistant turns must be merged by Anthropic or Gemini adapters as a fallback, this banner ensures that the model reading the prompt knows exactly which colleague authored each paragraph.

---

## 5. Per-Agent Configuration & Multi-Provider Execution

A key strength of Glassbeetle is that teams can be **heterogeneous**:

- Member 1 (Architect) can run `claude-3-5-sonnet` (Anthropic).
- Member 2 (Coder) can run `gpt-4o` (OpenAI).
- Member 3 (Auditor) can run `llama3:8b` locally (Ollama).

```
                      ┌─────────────────────────────────┐
                      │    Team Chat (team_id: T1)      │
                      └────────────────┬────────────────┘
                                       │
         ┌─────────────────────────────┼─────────────────────────────┐
         ▼                             ▼                             ▼
┌─────────────────┐           ┌─────────────────┐           ┌─────────────────┐
│ Member 1: Alice │           │ Member 2: Bob   │           │ Member 3: Local │
├─────────────────┤           ├─────────────────┤           ├─────────────────┤
│ Model: Claude   │           │ Model: GPT-4o   │           │ Model: Llama 3  │
│ Provider: Cloud │           │ Provider: Cloud │           │ Provider: Local │
│ Prompt: System A│           │ Prompt: System B│           │ Prompt: System C│
│ Memory: Priv A  │           │ Memory: Priv B  │           │ Memory: Priv C  │
└─────────────────┘           └─────────────────┘           └─────────────────┘
```

### 5.1 Independent Execution Chains

Each agent's turn resolves its own execution chain independently:
$$\text{Chat} \longrightarrow \text{Active Member Agent} \longrightarrow \text{Model} \longrightarrow \text{Provider} \longrightarrow \text{Credential}$$

1. **System Prompt Isolation**:
   - Alice's turn uses Alice's `system_prompt_id`, `personality`, and `instructions`.
   - Bob's turn uses Bob's distinct `system_prompt_id`, `personality`, and `instructions`.
   - Instructions never leak across agents into the shared transcript.
2. **Memory Privacy Invariant**:
   - `agent_memories` for Alice are **never** visible in Bob's system prompt.
   - Shared memories (`shared_memories`) are accessible to all team members according to standard memory retrieval rules ([RFC 41](rfc-semantic-memory.md)).
3. **Sampling Parameters**:
   - `temperature`, `max_tokens`, and `model_params` are resolved per-agent. A creative brainstormer can use `temperature: 0.9` while the subsequent code validator uses `temperature: 0.1`.
4. **Interaction with Conversation Compaction (`chats.context_summary`)**:
   - If a long team chat is compacted via `POST /chats/:id/compact`, the resulting `context_summary` is shared across all team members as foundational background.
   - During context construction, the summary is placed in the system layer:
     `Context summary:\n{context_summary}`
   - Superseded turns (`sequence < compacted_before_sequence`) are pruned identically for all members, conserving token budget across every agent's context window.

---

## 6. Message Attribution & Deletion Invariants

### 6.1 Database Persistence Rules

1. **User Message**:
   - Inserted with `role = 'user'`, `agent_id = NULL`.
2. **Agent Messages**:
   - Inserted with `role = 'assistant'`, `agent_id = <speaking_agent_id>`.
   - Assigned strictly increasing, atomic `sequence` numbers via SQLite transaction.
3. **Chat `updated_at`**:
   - Advanced on every completed agent reply.

### 6.2 Handling Deleted Agents (`ON DELETE SET NULL`)

In `data/chats/messages.sql`:

```sql
agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL
```

If an agent is deleted after participating in a team chat:

1. SQLite automatically sets `messages.agent_id = NULL` for all messages authored by that agent.
2. **Context Construction Invariant**:
   - The message row persists in full. The transcript is not corrupted.
   - When building prompt context for subsequent turns, if `messages.agent_id` is null on an `assistant` turn:
     - The message is labeled with fallback attribution: `[Team Member: Former Agent]`.
     - Generation proceeds without throwing `AGENT_NOT_FOUND`.
3. **UI Display Invariant**:
   - The UI renders the message with a subtle "Deleted Agent" pill rather than crashing or showing blank author headers.

---

## 7. Streaming Protocol for Multi-Agent Turns

When a user posts a message to a team chat with streaming enabled (`Accept: text/event-stream` or `stream: true`), how does the client receive output from multiple agents?

### 7.1 Single HTTP Connection Multiplexing

Opening separate HTTP connections for each agent in a team sequence creates race conditions, mobile battery drain, and connection exhaustion.

**Decision: A single SSE response connection streams the entire team sequence.**

```
Client                                                  Server (Team Orchestrator)
  │                                                                 │
  │── POST /api/v1/chats/:id/completions (stream=true) ────────────>│
  │                                                                 │
  │<── event: message_start (Alice, msg_01, seq 2) ─────────────────│
  │<── event: token ("Here is ") ───────────────────────────────────│
  │<── event: token ("the architecture.") ──────────────────────────│
  │<── event: message_complete (Alice complete) ────────────────────│
  │                                                                 │
  │<── event: message_start (Bob, msg_02, seq 3) ───────────────────│
  │<── event: token ("I will ") ────────────────────────────────────│
  │<── event: token ("implement the schema.") ──────────────────────│
  │<── event: message_complete (Bob complete) ──────────────────────│
  │                                                                 │
  │<── event: usage (aggregated tokens & cost) ─────────────────────│
  │<── event: done ("[DONE]") ──────────────────────────────────────│
```

### 7.2 SSE Event Wire Structure

The SSE event taxonomy established in [`realtime-transport.md`](realtime-transport.md) and [`sse-event.ts`](../apps/api/src/modules/chats/completions/dto/sse-event.ts) is extended naturally:

1. **`message_start`**:
   Emitted before the active agent begins streaming tokens. Carries the agent's ID and display name:
   ```json
   {
     "type": "message_start",
     "data": {
       "messageId": "018f3a9e-0000-7000-8000-000000000010",
       "chatId": "018f3a9e-0000-7000-8000-000000000001",
       "sequence": 2,
       "role": "assistant",
       "agentId": "018f3a9e-0000-7000-8000-000000000005",
       "agentName": "Alice (Architect)",
       "status": "pending"
     }
   }
   ```
2. **`token` / `thought`**:
   Contains incremental content delta bound to `messageId`.
3. **`message_complete`**:
   Emitted when the current agent completes generation and its row is committed to SQLite with `status = 'complete'`.
4. **`done`**:
   Emitted once after the final team member has finished its turn.

---

## 8. Failure Handling & Resilience Mid-Turn

What happens if Agent 1 succeeds, but Agent 2 encounters an upstream rate limit (HTTP 429) or timeout (HTTP 504)?

### 8.1 The Two Approaches

- **Approach 1: Atomic Rollback (All-or-Nothing)**: Delete Agent 1's persisted message and return an HTTP error.
  - _Flaw_: Discards real tokens already generated and paid for; confusing to the user who may have seen Agent 1's thoughts streamed live.
- **Approach 2: Partial Success & Graceful Pipeline Pause (Recommended)**:
  - Agent 1's reply remains persisted with `status = 'complete'`.
  - Agent 2's failed reply is marked with `status = 'error'` in SQLite, preserving any partial content generated prior to the failure.
  - The team pipeline **pauses**; downstream agents (Agent 3) are not executed on corrupted or missing intermediate context.
  - In streaming mode, an in-band `error` event is emitted naming the failed agent and the normalized error code (e.g., `RATE_LIMIT_EXCEEDED`), followed by `done`.
  - In non-streaming mode, the endpoint returns HTTP 200 with the partially completed messages list, or maps the error with a payload identifying completed turns.

---

## 9. The Semantic Meaning of `team_members.role`

The schema column `team_members.role` is currently unconstrained `TEXT`:

```sql
CREATE TABLE team_members (
    team_id      TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    agent_id     TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    role         TEXT,
    position     INTEGER,
    created_at   TEXT NOT NULL,
    PRIMARY KEY (team_id, agent_id)
);
```

### 9.1 Decision: Descriptive Persona Context (Not Orchestration Keywords)

- **Do not overload `role` with operational control enums** (e.g. avoiding magic strings like `"coordinator"` or `"worker"`). Overloading free-text columns for control logic invites typos and fragile runtime parsing.
- **Role is defined as descriptive contextual metadata**:
  - Example values: `"Database Architect"`, `"Security Auditor"`, `"QA Engineer"`, `"Devil's Advocate"`.
  - During context construction, the role is injected into the agent's system prompt instructions:
    > _"In this conversation, you are collaborating as the **{role}** for team '{team_name}'."_
  - This primes the model to adopt its specific departmental responsibilities without needing custom system prompt templates for every team assignment.

---

## 10. Cost & Spend Governance

A team conversation multiplies inference costs linearly by the number of members participating in each turn.

```
1 User Message to 4-Agent Team = 4 Distinct Model Calls
Turn 1 (Agent 1):  1,000 prompt tokens + 300 output tokens  ≈ $0.005
Turn 2 (Agent 2):  1,300 prompt tokens + 400 output tokens  ≈ $0.008
Turn 3 (Agent 3):  1,700 prompt tokens + 350 output tokens  ≈ $0.011
Turn 4 (Agent 4):  2,050 prompt tokens + 500 output tokens  ≈ $0.015
Total per User Interaction: ~6,000 prompt + 1,550 output tokens ≈ $0.039
```

### 10.1 Safeguards

1. **Per-Turn Budget Enforcement**:
   - The spend budget service ([`spend-budget.md`](spend-budget.md)) evaluates accumulated monthly/daily spend before initiating _each_ agent's turn.
   - If a budget threshold is exceeded after Agent 1 completes, Agent 2 is not invoked, preventing budget overruns.
2. **Aggregated Usage Accounting**:
   - Each agent turn logs its own distinct row in `usage_events`:
     ```sql
     INSERT INTO usage_events (
       id, occurred_at, event_type, agent_id, provider_id, model_id, chat_id,
       input_tokens, output_tokens, cost_usd
     ) VALUES (?, ?, 'chat_completion', ?, ?, ?, ?, ?, ?, ?);
     ```
   - Analytics and spend dashboards can attribute costs both per-chat and per-individual agent.
3. **Local-First Recommendation**:
   - Documentation and UI should guide users to configure hybrid teams (e.g., using fast, free local Ollama models for intermediate drafting or summarization, reserving frontier hosted models like Claude 3.5 Sonnet for final synthesis).

---

## 11. Proposed Schema Evolution (Named for Future Issues)

_Note: Per the RFC scope, no schema changes are made in this issue._ The following schema additions are named for future dedicated `area:database` issues:

1. **`teams.strategy TEXT DEFAULT 'sequential'`**:
   - Allows choosing team behavior: `'sequential'` (Phase 1 pipeline), `'coordinator'` (Phase 2 router), or `'broadcast'` (Phase 3 parallel).
2. **`teams.max_turns_per_interaction INTEGER DEFAULT 5`**:
   - Configurable safety guardrail replacing hardcoded bounds.
3. **`team_members.is_coordinator INTEGER DEFAULT 0 CHECK (is_coordinator IN (0, 1))`**:
   - Explicit boolean flag identifying the lead coordinator, avoiding fragile string matching on `team_members.role`.

---

## 12. Phase 1 Implementation Specification (Shippable Increment)

The minimal shippable increment is completely achievable on the existing schema:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PHASE 1 SCOPE DEFINITION                           │
├───────────────────────────────┬─────────────────────────────────────────────┤
│ Component                     │ Phase 1 Behavior                            │
├───────────────────────────────┼─────────────────────────────────────────────┤
│ Turn-Taking                   │ Sequential Position Pipeline                │
│                               │ (ORDER BY position ASC NULLS LAST)          │
├───────────────────────────────┼─────────────────────────────────────────────┤
│ Turn Limit                    │ Exactly 1 pass per team member (max 10)     │
├───────────────────────────────┼─────────────────────────────────────────────┤
│ Context Visibility            │ Peer messages framed with attributed        │
│                               │ identity banners: [Team Member: Name (Role)]│
├───────────────────────────────┼─────────────────────────────────────────────┤
│ Provider Compatibility        │ Merging / User relabeling ensures           │
│                               │ 100% compliance with Anthropic & Gemini     │
├───────────────────────────────┼─────────────────────────────────────────────┤
│ Streaming                     │ Single SSE connection yielding sequential   │
│                               │ message_start -> tokens -> complete events  │
├───────────────────────────────┼─────────────────────────────────────────────┤
│ Database Migrations           │ NONE required. Fully supported today.       │
└───────────────────────────────┴─────────────────────────────────────────────┘
```

### 12.1 Execution Flow

When `POST /api/v1/chats/:chatId/completions` is called for a chat where `chat.team_id IS NOT NULL`:

1. **Load Team Members**:
   Query active members ordered by `position ASC NULLS LAST, created_at ASC`. If empty, fail with HTTP 422 `TEAM_HAS_NO_MEMBERS`.
2. **Iterate Members Sequentially**:
   For each member $k \in \{1 \dots K\}$:
   a. Resolve execution chain for Member $k$ (Agent $\rightarrow$ Model $\rightarrow$ Provider $\rightarrow$ Credential).
   b. Construct context: format existing transcript, labeling peer turns with participant banners. Apply Member $k$'s system prompt, personality, and instructions.
   c. Invoke Member $k$'s provider adapter (streaming or non-streaming).
   d. Persist generated reply in `messages` with `agent_id = member_k.agent_id` and advance `chats.updated_at`.
   e. Emit streaming events (`message_start`, `token`, `message_complete`).
3. **Emit Terminal Event**:
   Emit `usage` and `done` upon completion of the final member.

---

## 13. Summary & Decision Matrix

| Dimension              | Architectural Decision                                                                                                              |
| :--------------------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| **Turn-Taking**        | **Deterministic Sequential Pipeline** via `team_members.position ASC`. Zero routing overhead, 100% predictable.                     |
| **Termination**        | **Single pass per user interaction** ($K$ agent responses). Hard safety cap at 10 turns. Immediate abort on client disconnect.      |
| **Context Visibility** | **Peer-attributed banners** (`[Team Member: Name (Role)]`). Complies with Anthropic/Gemini alternation rules without persona bleed. |
| **Configuration**      | **Fully heterogeneous**. Each agent resolves its own model, provider, temperature, instructions, and private memories.              |
| **Attribution**        | `messages.agent_id` set on every assistant message. Nullable fallback (`[Deleted Agent]`) preserves historical transcripts.         |
| **Streaming**          | **Single SSE connection multiplexing**. Sequential `message_start` events notify the frontend of active speaker transitions.        |
| **Failure Handling**   | **Graceful pause on error**. Preceding turns are preserved; failing turn marked `status: 'error'`; downstream turns halted.         |
| **Role Column**        | **Descriptive identity context**. Injected into system prompt; not overloaded with orchestration control tokens.                    |
| **Cost Control**       | Pre-turn spend budget checks; granular attribution in `usage_events`; recommendation of hybrid local/cloud teams.                   |
