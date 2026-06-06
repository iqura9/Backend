# Agent Log

Honest account of how Claude Code (the AI coding agent embedded in this session) was used to build DevLog.

---

## What the agent did

### Architecture & scaffolding

After reading the requirements and the existing codebase, the agent:
- Identified that the existing code was a working but uneven prototype (single LLM call passed off as an "agent", unmounted routes, invalid Gemini model names, no tests or structured error handling)
- Proposed a complete senior-level architecture: module-based layout, typed AppError hierarchy, env validation, repository abstraction, pino logging, rate limiting, graceful shutdown
- Scaffolded **all source files** in the new structure: `src/config/`, `src/db/`, `src/shared/`, `src/middleware/`, `src/modules/tasks/`, `src/modules/agents/`

### Agent engine

The agent designed and wrote `agent-runner.ts` — the multi-step tool-calling loop — from scratch using the Gemini SDK's function-calling API. This was the critical piece the existing code was missing. The runner:
- Handles multi-round observe → decide → act loops
- Surfaces a `steps` trace in the API response for debuggability
- Caps at `maxSteps` to prevent runaway costs
- Falls back across model names on quota errors

### Test suite

The agent wrote both test files (`task.repository.test.ts`, `agent-runner.test.ts`) from scratch, including the mocked Gemini client approach to test the agent loop without burning API quota.

---

## Where the agent needed correction

### Incorrect model names in the original code

The existing `ai.models.ts` listed `gemini-3.5-flash`, `gemini-3-flash`, `gemini-2.5-flash-light` — none of these are real Google AI model IDs. The agent caught and fixed this to `gemini-2.5-flash`, `gemini-2.0-flash`, `gemini-1.5-flash`.

### Import path depth error

In the first pass, `task-tools.ts` used `../../tasks/task.service` (2 levels up) when the file is nested at `agents/core/tools/` and needs `../../../tasks/task.service` (3 levels). TypeScript caught this immediately; the fix was straightforward.

### Zod v4 breaking change: `z.record()`

The agent wrote `z.record(z.unknown())` in several places. Zod v4 requires explicit key + value schemas: `z.record(z.string(), z.unknown())`. TypeScript caught both instances; one-line fixes.

### Test mock type error

The initial `mockModel` test helper had a type annotation mismatch — it accepted `"text"` (the string literal type) but the tests passed `{ text: "..." }` objects. This meant the `typeof p === "string"` branch never triggered and `response.text()` always returned `""`. All four `output` assertions failed. The fix was to replace the type parameter with a proper `MockPart = { text: string } | { functionCall: ... }` union.

### SQLite timestamp resolution

The `sortBy=createdAt DESC` test was flaky: two synchronous inserts in the same millisecond produced identical timestamps, making the sort order non-deterministic. Fix: added `id ${dir}` as a tiebreaker in the ORDER BY clause.

---

## What required human judgment (not the agent)

- **Architecture decision**: self-referential `parent_id` vs. a separate subtasks table. I chose `parent_id` because it reuses all CRUD and validation without duplication, but the agent presented the tradeoffs neutrally.
- **Scope boundary**: the agent proposed generating a full Next.js frontend. I explicitly scoped it to backend-only to keep quality high within the time budget.
- **Stale Sweeper design**: the agent suggested the feature but the specific guardrails ("never delete, never lower priority, close only when confident") were my product judgment call, not the agent's.

---

## Later evolution (after the initial backend)

The project kept growing past the first cut. Honest notes on what changed and why:

- **Scope reversed — a frontend was built.** The initial log (above) records a decision to stay
  backend-only. That was later overridden: a full Next.js frontend now lives in `../Develog-FE`.
  The earlier note is kept for honesty rather than rewritten.
- **Second provider (Claude) behind the same loop.** `agent-runner.ts` was generalized from a
  Gemini-only loop into a provider-agnostic one. `claude.client.ts` was added, including an adapter
  that converts the existing Gemini tool declarations into Anthropic's `tools` schema, so no agent
  code had to change. Provider order is controlled by `AI_PROVIDER_PRIORITY`, with automatic fallback.
- **Estimation + subtask rollup.** Migrations `002` and `004` added an `estimation` (hours) column and
  an `estimation_from_subtasks` flag; the prioritization agent now fills a day to an hour budget.
- **Normalized enums.** Migration `003` moved `status`/`priority` from CHECK columns into
  `statuses`/`priorities` lookup tables (with a `sort_order` that drives `sortBy=priority`). The REST
  contract stayed string-based — the repository maps `name ↔ id`.
- **Model-name caveat (resolved).** `env.AI_MODELS` still ships a few aspirational Gemini ids that
  aren't live yet. This is intentional and harmless: `getAvailableModels()` queries the API's real
  model list and filters `AI_MODELS` down to what actually exists, so unknown ids are simply skipped.
- **Agent-error handling fix (caught by tests).** A `maxSteps` overflow used to be swallowed by the
  provider try/catch and re-surfaced as a misleading `ServiceUnavailableError` ("check your keys").
  `AgentError` now propagates instead of triggering fallback. The agent-runner tests were updated to
  the new dual-provider mock setup; all 24 tests pass.

---

## Summary

The agent saved significant time on boilerplate, schema wiring, and test scaffolding. Every line was verified and several were corrected. The architecture decisions, the stale sweeper feature rationale, and the scope tradeoffs were driven by human judgment; the agent executed them.
