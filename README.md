# DevLog Backend

Task tracker API for engineering teams with a genuine multi-step AI agent layer.
The Next.js frontend lives in `../Develog-FE` and talks to this service over REST.

## Quick start

```bash
cp .env.example .env          # add GEMINI_API_KEY and/or ANTHROPIC_API_KEY
npm install
npm run dev                    # http://localhost:3001
```

Open **`http://localhost:3001/docs`** for the interactive Swagger UI.  
Run **`npm test`** to execute the automated test suite (Vitest, 24 tests).

CRUD endpoints work without any API key. The AI agent endpoints need at least one
provider key (`GEMINI_API_KEY` or `ANTHROPIC_API_KEY`) and return `503` when neither is set.

### Run the whole stack with Docker

The compose file lives in the sibling **`Develog-FE/`** folder and orchestrates this API + the
Next.js frontend (the two folders sit side by side):

```bash
cp Backend/.env.example Backend/.env   # add your AI key(s)
cd Develog-FE
docker compose up --build
# frontend → http://localhost:4000   backend → http://localhost:4001
```

Both services run in **production** mode on non-default ports (so they can sit behind nginx — override
with `FRONTEND_PORT` / `BACKEND_PORT`). The SQLite file is bind-mounted from `Backend/data/`, so data
survives `docker compose down` and rebuilds. In production CORS is locked to `CORS_ORIGIN`
(default `https://devlog.iqurabooks.com`).

---

## Architecture

```
src/
  config/env.ts               — zod-validated, typed, frozen env (fail-fast on boot)
  db/
    connection.ts             — better-sqlite3 factory; WAL mode, FK ON, synchronous=NORMAL
    migrations/               — ordered .sql files, tracked by a _migrations table
      001_init.sql            — tasks table (status/priority CHECK enums)
      002_estimation.sql      — per-task estimation (hours)
      003_normalize_enums.sql — status/priority moved to lookup tables (statuses, priorities)
      004_estimation_from_subtasks.sql — flag to roll a task's estimate up from its subtasks
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
        gemini.client.ts      — lazy Gemini model factory + live model discovery
        claude.client.ts      — lazy Anthropic client + Gemini→Anthropic tool-schema adapter
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

| Field                    | Type    | Notes                                      |
|--------------------------|---------|--------------------------------------------|
| id                       | INTEGER | PK, autoincrement                          |
| parent_id                | INTEGER | FK → tasks(id) ON DELETE CASCADE; null = root task |
| title                    | TEXT    | Required, max 255                          |
| description              | TEXT    | Optional, max 10 000                       |
| status_id                | INTEGER | FK → statuses(id); exposed as `status` (todo \| in-progress \| done) |
| priority_id              | INTEGER | FK → priorities(id); exposed as `priority` (low \| medium \| high) |
| estimation               | REAL    | Estimated effort in hours; nullable        |
| estimation_from_subtasks | INTEGER | 0/1 flag; when 1, effective estimate = sum of subtasks' estimations |
| created_at               | TEXT    | ISO-8601, set on insert                    |
| updated_at               | TEXT    | ISO-8601, maintained by an AFTER UPDATE trigger |

`status` and `priority` are normalized into `statuses` / `priorities` lookup tables (each with a
`sort_order` column that powers `sortBy=priority`). The REST contract stays string-based — the
repository maps `name ↔ id` via a JOIN, so the API never exposes the FK ids.

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
    "output": "<agent's answer — markdown, or a JSON string for some agents>",
    "model": "gemini-2.5-flash",
    "steps": [{ "tool": "list_tasks", "args": {}, "result": [...] }]
  }
}
```

The `steps` array is the full tool-call trace, proving multi-step reasoning. `model` reflects whichever
provider actually served the request (a Gemini model id, or `claude-haiku-4-5-…`).

| Endpoint | Agent | Description |
|---|---|---|
| `POST /api/agents/prioritize` | Prioritization | Reads every task, ranks by priority + age + momentum, and fills a ~7–8h day to a budget using each task's `estimation`. Returns a structured day plan. |
| `POST /api/agents/decompose` | Decomposition | Fetches task details **and existing subtasks**, returns `needs_clarification` for vague tasks, otherwise generates role-prefixed (`[FE]`/`[BE]`/`[DevOps]`/`[QA]`) subtasks with estimates; writes to DB when `persist: true` |
| `POST /api/agents/status-update` | Status Update | Scans all tasks by `updatedAt`, buckets today's work into done / in-progress / next-up, optionally compares against a supplied day plan, and emits a Slack-style standup |
| `POST /api/agents/sweep-stale` | Stale Sweeper *(custom)* | Identifies tasks stuck beyond a threshold; diagnoses cause; when `apply: true`, safely triages (raise priority / split / escalate) |

---

## The agent engine

`agent-runner.ts` runs a bounded, provider-agnostic **observe → decide → act** loop:

1. Build tool declarations and a system instruction from the calling agent.
2. Pick a provider by `AI_PROVIDER_PRIORITY` (the other is the fallback); fall through to it when the primary key is missing or the call fails.
3. Send the user message; inspect the response.
4. Tool-call parts → execute via `ToolRegistry` (backed by `TaskService`) → feed the results back. Repeat.
5. No tool calls → return text. A `maxSteps` overflow raises `AgentError` and is **not** masked as a provider failure (so you get the real cause, not a misleading "check your keys").

Two providers are supported behind one loop: **Gemini** (`gemini.client.ts`, native function calling +
live model discovery) and **Anthropic Claude** (`claude.client.ts`, which adapts the same Gemini
tool schemas to Anthropic's `tools` format). This is a genuine agent, not a single prompt — the model
decides which tools to call, in what order, based on what it observes.

### Why Stale Sweeper?

Neglected tickets are a silent productivity killer in eng teams. They inflate estimates, mask blockers, and erode trust in the backlog. A periodic automated sweep that diagnoses *why* a task is stuck and proposes (or applies) a concrete action replaces recurring manual backlog grooming. The `apply=false` default makes it safe for read-only auditing; `apply=true` enables autonomous remediation with guardrails (never deletes, never lowers priority, closes only when confident).

---

## Scope tradeoffs

- **No auth**: single-user, single-team — as specified.
- **Two providers, one loop**: Gemini and Claude share the same runner so reviewers can plug in
  whichever key they have. `AI_PROVIDER_PRIORITY` picks the primary; the other is automatic fallback.
- **SQLite over Postgres**: zero infra, enough for the scale; limitation documented above.
- **One-level subtask nesting**: keeps the data model simple and avoids recursive tree queries. Two levels is where most task trackers start and it covers the decomposition use-case cleanly.
- **No retries on agent tool failures**: tool errors are returned to the model as `{ error: "..." }` rather than retried — the model can decide whether to try again or adapt.
