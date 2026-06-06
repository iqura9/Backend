import { z } from "zod";
import { runAgent, type AgentResult } from "./core/agent-runner";
import type { ToolRegistry } from "./core/tool-registry";
import { parseLastValidJson } from "./core/parse-json-response";
import { logger } from "../../shared/logger";

const SYSTEM_PROMPT = `You are a staff engineer composing a daily standup report.

Reason SILENTLY using the tools, then respond with ONLY a single JSON object — no markdown, no code fences, no prose before or after it.

How to think (internally, do not output):
1. Call list_tasks (no filter) to get every task and subtask.
2. Determine today's date from the user message ("Today is …").
3. Keep tasks whose updatedAt starts with today's date (YYYY-MM-DD). These are the tasks touched today.
4. Bucket them:
   - doneToday: status === "done" AND updatedAt is today.
   - inProgress: status === "in-progress" AND updatedAt is today.
   - nextUp: top 3 non-done root tasks (parentId === null) NOT already in the above lists, ranked by priority (high > medium > low).
5. If a plan was provided: match each plan item id against doneToday ids → completed count; the rest are slipped.
6. blockers: an empty array unless the caller's notes explicitly mention a blocker.
7. summary: a single headline sentence like "Completed 2 tasks, 1 in progress" — do NOT mention raw task IDs.

Respond with EXACTLY this JSON shape and nothing else:
{
  "date": "<YYYY-MM-DD for today>",
  "summary": "<one-line headline>",
  "doneToday": [{ "id": <number>, "title": <string>, "status": "done" }],
  "inProgress": [{ "id": <number>, "title": <string>, "status": "in-progress" }],
  "nextUp": [{ "id": <number>, "title": <string>, "status": <string> }],
  "blockers": [],
  "planComparison": {
    "planned": <number — total plan items, omit key entirely if no plan supplied>,
    "completed": <number — plan items that are done today>,
    "slipped": [{ "id": <number>, "title": <string>, "status": <string> }]
  }
}

Rules:
- Output nothing but the JSON object.
- Omit the "planComparison" key entirely when no plan is provided.
- "nextUp" must have at most 3 items and must exclude tasks already in doneToday or inProgress.
- Never include task IDs in "summary".`;

export interface StatusUpdatePlanItem {
  id: number;
  title: string;
  hours: number;
}

export interface StatusUpdatePlan {
  items: StatusUpdatePlanItem[];
  focus?: string;
  totalHours?: number;
}

export interface StatusUpdateInput {
  /** Deprecated — ignored; scoping is now date-based. Kept for backwards-compat. */
  taskId?: number;
  plan?: StatusUpdatePlan;
  notes?: string;
  tone?: "technical" | "casual" | "formal";
}

// ─── Response schema (lenient: passthrough keeps any extra fields) ──────────────

const reportTaskSchema = z
  .object({ id: z.coerce.number(), title: z.string(), status: z.string() })
  .passthrough();

export const statusUpdateReportSchema = z
  .object({
    date: z.string(),
    summary: z.string(),
    doneToday: z.array(reportTaskSchema).default([]),
    inProgress: z.array(reportTaskSchema).default([]),
    nextUp: z.array(reportTaskSchema).default([]),
    blockers: z.array(z.unknown()).default([]),
    planComparison: z
      .object({
        planned: z.coerce.number().optional(),
        completed: z.coerce.number().optional(),
        slipped: z.array(reportTaskSchema).default([]),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type StatusUpdateReport = z.infer<typeof statusUpdateReportSchema>;

export interface StatusUpdateResult extends AgentResult {
  report: StatusUpdateReport;
}

const TOOL_NAMES = ["list_tasks", "get_task"] as const;

export async function runStatusUpdateAgent(
  input: StatusUpdateInput,
  registry: ToolRegistry,
): Promise<StatusUpdateResult> {
  const today = new Date().toISOString();

  const parts = [`Today is ${today}. Generate a standup report for today's work.`];

  if (input.plan) {
    parts.push(
      `Day plan provided (use for planComparison): ${JSON.stringify(input.plan)}`,
    );
  }

  if (input.notes) {
    parts.push(`Additional notes from the engineer: "${input.notes}"`);
  }

  if (input.tone) {
    parts.push(`Requested tone: ${input.tone}`);
  }

  const result = await runAgent({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: parts.join("\n"),
    toolNames: [...TOOL_NAMES],
    registry,
  });

  const parsed = parseLastValidJson(result.output, statusUpdateReportSchema);
  if (!parsed) {
    logger.warn({ output: result.output }, "Status-update agent returned no valid JSON report");
  }
  const report = parsed ?? fallbackReport(today.slice(0, 10));

  return { ...result, output: JSON.stringify(report), report };
}

function fallbackReport(date: string): StatusUpdateReport {
  return {
    date,
    summary: "Couldn't generate a standup report — please try again.",
    doneToday: [],
    inProgress: [],
    nextUp: [],
    blockers: [],
  };
}
