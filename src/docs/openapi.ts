import { OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
  taskResponseSchema,
  createTaskSchema,
  updateTaskSchema,
  taskQuerySchema,
} from "../modules/tasks/task.schema";
import {
  decomposeRequestSchema,
  statusUpdateRequestSchema,
  sweepRequestSchema,
} from "../modules/agents/agent.schema";

const registry = new OpenAPIRegistry();

// ─── Shared response helpers ──────────────────────────────────────────────────

const envelopeOf = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({ data: dataSchema });

const listEnvelopeOf = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({ data: z.array(itemSchema), meta: z.object({ count: z.number() }) });

const errorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .openapi("ErrorResponse");

const agentResultSchema = z
  .object({
    data: z.object({
      output: z.string().openapi({ description: "Agent's final text output" }),
      model: z.string().openapi({ description: "Gemini model that produced the answer" }),
      steps: z
        .array(
          z.object({
            tool: z.string(),
            args: z.record(z.string(), z.unknown()),
            result: z.unknown(),
          }),
        )
        .openapi({ description: "Trace of every tool call and its result" }),
    }),
  })
  .openapi("AgentResult");

// Register named schemas
registry.register("Task", taskResponseSchema);
registry.register("CreateTaskInput", createTaskSchema);
registry.register("UpdateTaskInput", updateTaskSchema);
registry.register("ErrorResponse", errorSchema);
registry.register("AgentResult", agentResultSchema);

// ─── Task endpoints ───────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/api/tasks",
  summary: "List all tasks",
  description: "Supports filtering by status/priority and sorting by priority or creation date. Pass `parentId=null` to get only top-level tasks.",
  tags: ["Tasks"],
  request: { query: taskQuerySchema },
  responses: {
    200: { description: "OK", content: { "application/json": { schema: listEnvelopeOf(taskResponseSchema) } } },
    400: { description: "Validation error", content: { "application/json": { schema: errorSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/tasks",
  summary: "Create a task or subtask",
  description: "Pass `parentId` to make it a subtask. Nesting is limited to one level.",
  tags: ["Tasks"],
  request: { body: { content: { "application/json": { schema: createTaskSchema } } } },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: envelopeOf(taskResponseSchema) } } },
    400: { description: "Validation error", content: { "application/json": { schema: errorSchema } } },
    404: { description: "Parent task not found", content: { "application/json": { schema: errorSchema } } },
    409: { description: "Nesting conflict", content: { "application/json": { schema: errorSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/tasks/{id}",
  summary: "Get a single task",
  tags: ["Tasks"],
  request: { params: z.object({ id: z.string().openapi({ example: "1" }) }) },
  responses: {
    200: { description: "OK", content: { "application/json": { schema: envelopeOf(taskResponseSchema) } } },
    404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/tasks/{id}",
  summary: "Partially update a task",
  tags: ["Tasks"],
  request: {
    params: z.object({ id: z.string().openapi({ example: "1" }) }),
    body: { content: { "application/json": { schema: updateTaskSchema } } },
  },
  responses: {
    200: { description: "OK", content: { "application/json": { schema: envelopeOf(taskResponseSchema) } } },
    400: { description: "Validation error", content: { "application/json": { schema: errorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/tasks/{id}",
  summary: "Delete a task (cascades to subtasks)",
  tags: ["Tasks"],
  request: { params: z.object({ id: z.string().openapi({ example: "1" }) }) },
  responses: {
    204: { description: "Deleted" },
    404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
  },
});

// ─── Agent endpoints ──────────────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/agents/prioritize",
  summary: "Prioritization Agent",
  description:
    "Multi-step agent that fetches all tasks and reasons over priority, age, and status to produce a ranked action plan with per-task rationale. Returns a `steps` trace showing every tool call.",
  tags: ["Agents"],
  responses: {
    200: { description: "OK", content: { "application/json": { schema: agentResultSchema } } },
    429: { description: "Rate limit exceeded" },
    503: { description: "GEMINI_API_KEY not configured", content: { "application/json": { schema: errorSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/decompose",
  summary: "Decomposition Agent",
  description:
    "Breaks a task into actionable subtasks. Returns `needs_clarification` with a targeted question when the task is too vague. When `persist=true`, writes subtasks to the DB.",
  tags: ["Agents"],
  request: { body: { content: { "application/json": { schema: decomposeRequestSchema } } } },
  responses: {
    200: { description: "OK", content: { "application/json": { schema: agentResultSchema } } },
    400: { description: "Validation error", content: { "application/json": { schema: errorSchema } } },
    503: { description: "AI unavailable", content: { "application/json": { schema: errorSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/status-update",
  summary: "Status Update Agent",
  description:
    "Generates a Slack-style async status update for a task and its subtasks. Adapts tone to task type (hotfix vs feature vs chore).",
  tags: ["Agents"],
  request: { body: { content: { "application/json": { schema: statusUpdateRequestSchema } } } },
  responses: {
    200: { description: "OK", content: { "application/json": { schema: agentResultSchema } } },
    400: { description: "Validation error", content: { "application/json": { schema: errorSchema } } },
    503: { description: "AI unavailable", content: { "application/json": { schema: errorSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/agents/sweep-stale",
  summary: "Stale Sweeper Agent (custom)",
  description:
    "Identifies tasks stuck without updates beyond a threshold (default: 7 days). Diagnoses likely causes and, when `apply=true`, performs safe triage actions: raise priority, split scope, or escalate.",
  tags: ["Agents"],
  request: { body: { content: { "application/json": { schema: sweepRequestSchema } } } },
  responses: {
    200: { description: "OK", content: { "application/json": { schema: agentResultSchema } } },
    400: { description: "Validation error", content: { "application/json": { schema: errorSchema } } },
    503: { description: "AI unavailable", content: { "application/json": { schema: errorSchema } } },
  },
});

// ─── Generator ────────────────────────────────────────────────────────────────

export function generateOpenApiSpec() {
  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: "3.0.0",
    info: {
      title: "DevLog API",
      version: "1.0.0",
      description:
        "Task tracker for engineering teams with a genuine multi-step AI agent layer. CRUD always works; AI features require GEMINI_API_KEY.",
    },
    servers: [{ url: "http://localhost:3001" }],
  });
}
