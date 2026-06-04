# DevLog Backend

Task tracker API for engineering teams with a genuine multi-step AI agent layer.

## Quick start

```bash
cp .env.example .env          # add your GEMINI_API_KEY
npm install
npm run dev                    # http://localhost:3001
```

Open **`http://localhost:3001/docs`** for the interactive Swagger UI.  
Run **`npm test`** to execute the automated test suite.

CRUD endpoints work without an API key. AI agent endpoints return `503` if `GEMINI_API_KEY` is missing.

---

## Architecture

```
src/
  config/env.ts               — zod-validated, typed, frozen env (fail-fast on boot)
  db/
    connection.ts             — better-sqlite3 factory; WAL mode, FK ON, synchronous=NORMAL
    migrations/001_init.sql   — schema tracked by a _migrations table
  shared/
    errors.ts                 — AppError hierarchy (NotFound, Validation, Conflict, ServiceUnavailable, Agent)
    logger.ts                 — pino with pino-pretty in dev
    http.ts                   — ok() / created() response envelope helpers
  middleware/
    error-handler.ts          — maps every AppError to { error: { code, message, details? } }
    validate.ts               — validateBody / validateQuery / validateParams (zod)
    rate-limit.ts             — express-rate-limit: 300 req/15 min general; 10 req/min for AI
  modules/
    tasks/                    — feature module: model, schema, repository, service, controller, routes
    agents/
      core/
        gemini.client.ts      — lazy Gemini model factory; 503 guard
        agent-runner.ts       — generic multi-step tool-calling loop ← the real "agent"
        tool-registry.ts      — name-keyed tool store
        tools/task-tools.ts   — 5 task tools backed by TaskService
      prioritization.agent.ts
      decomposition.agent.ts
      status-update.agent.ts
      stale-sweeper.agent.ts
  docs/openapi.ts             — OpenAPI spec generated from the same zod schemas (never drifts)
  app.ts                      — composition root: wire deps, mount routers
  server.ts                   — listen + graceful shutdown (SIGTERM / SIGINT)
tests/
  task.repository.test.ts     — 17 tests: CRUD, filter, sort, subtask cascade
  agent-runner.test.ts        — 7 tests: loop logic, multi-round, error handling, auth
```

### Request flow

```
HTTP → express middleware (helmet, cors, pino-http, rate-limit)
     → validate middleware (zod)
     → controller
     → service (business rules, integrity checks)
     → SqliteTaskRepository (interface impl, injected at startup)
     → better-sqlite3
```

### Repository pattern

`TaskRepository` is an interface. `SqliteTaskRepository` is the SQLite implementation, injected into `TaskService` via `app.ts`. Swapping the storage layer (e.g. for Postgres in production) requires replacing one class and one line in `app.ts`.

---

## Data model

Tasks table with a `parent_id` self-reference (the Linear/Jira model):

| Field       | Type    | Notes                                      |
|-------------|---------|--------------------------------------------|
| id          | INTEGER | PK, autoincrement                          |
| parent_id   | INTEGER | FK → tasks(id) ON DELETE CASCADE; null = root task |
| title       | TEXT    | Required, max 255                          |
| description | TEXT    | Optional, max 10 000                       |
| status      | TEXT    | todo \| in-progress \| done                 |
| priority    | TEXT    | low \| medium \| high                       |
| created_at  | TEXT    | ISO-8601, set on insert                    |
| updated_at  | TEXT    | ISO-8601, maintained by an AFTER UPDATE trigger |

Nesting is capped at one level: a subtask cannot itself be a parent. Deleting a parent cascades to its subtasks.

**Why SQLite?** Single-process, zero infra, file-based persistence across restarts. WAL mode enables concurrent reads without blocking writes. Sufficient for a team tracker at this scale. Limitation: not suitable for multi-node horizontal scaling.

---

## API endpoints

### Tasks — `GET /api/tasks`

Query params: `status`, `priority`, `parentId` (`null` = top-level only, or a numeric ID), `sortBy` (`priority` | `createdAt`), `order` (`asc` | `desc`).

Full CRUD: `GET /api/tasks/:id`, `POST /api/tasks`, `PATCH /api/tasks/:id`, `DELETE /api/tasks/:id`.

### AI Agents — `POST /api/agents/*`

All agents return:
```json
{
  "data": {
    "output": "<agent's text answer>",
    "model": "gemini-2.5-flash",
    "steps": [{ "tool": "list_tasks", "args": {}, "result": [...] }]
  }
}
```

The `steps` array is the full tool-call trace, proving multi-step reasoning.

| Endpoint | Agent | Description |
|---|---|---|
| `POST /api/agents/prioritize` | Prioritization | Fetches all tasks, reasons over priority + age + status, returns a ranked "start your day" plan |
| `POST /api/agents/decompose` | Decomposition | Fetches task details, checks clarity, returns `needs_clarification` for vague tasks; generates subtasks; writes to DB when `persist: true` |
| `POST /api/agents/status-update` | Status Update | Gathers task + its subtasks, composes a Slack-style async update; adapts tone to task type |
| `POST /api/agents/sweep-stale` | Stale Sweeper *(custom)* | Identifies tasks stuck beyond a threshold; diagnoses cause; when `apply: true`, safely triages (raise priority / split / escalate) |

---

## The agent engine

`agent-runner.ts` runs a bounded **observe → decide → act** loop:

1. Start a Gemini chat with a system instruction and tool declarations.
2. Send the user message; inspect response parts.
3. `functionCall` parts → execute via `ToolRegistry` (backed by `TaskService`) → collect `functionResponse` parts → send back. Repeat.
4. No function calls → return text. Hard cap at `maxSteps` → `AgentError`.

This is a genuine agent, not a single prompt. The model decides which tools to call, in what order, based on what it observes — standard Observe-Reason-Act loop using Gemini's native function calling API.

### Why Stale Sweeper?

Neglected tickets are a silent productivity killer in eng teams. They inflate estimates, mask blockers, and erode trust in the backlog. A periodic automated sweep that diagnoses *why* a task is stuck and proposes (or applies) a concrete action replaces recurring manual backlog grooming. The `apply=false` default makes it safe for read-only auditing; `apply=true` enables autonomous remediation with guardrails (never deletes, never lowers priority, closes only when confident).

---

## Scope tradeoffs

- **No auth**: single-user, single-team — as specified.
- **No FE**: backend-only as instructed.
- **SQLite over Postgres**: zero infra, enough for the scale; limitation documented above.
- **One-level subtask nesting**: keeps the data model simple and avoids recursive tree queries. Two levels is where most task trackers start and it covers the decomposition use-case cleanly.
- **No retries on agent tool failures**: tool errors are returned to the model as `{ error: "..." }` rather than retried — the model can decide whether to try again or adapt.
