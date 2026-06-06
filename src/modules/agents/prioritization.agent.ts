import { z } from "zod";
import { runAgent, type AgentResult } from "./core/agent-runner";
import type { ToolRegistry } from "./core/tool-registry";
import { parseLastValidJson } from "./core/parse-json-response";
import { logger } from "../../shared/logger";

/** Day budget: aim for 7-8h, never exceed this hard cap. */
const DAY_HARD_CAP_HOURS = 9;
const MAX_ITEMS = 7;

const SYSTEM_PROMPT = `You are a senior engineering team lead producing a "start-your-day" plan for a single working day.

Reason SILENTLY using the tools, then respond with ONLY a single JSON object — no markdown, no code fences, no prose before or after it.

How to think (internally, do not output):
- Call list_tasks; if an item lacks detail, call get_task before finalizing.
- Rank non-done tasks by urgency (priority high>medium>low, plus age), momentum (prefer in-progress unless stalled), and impact (high-priority unblockers first).
- Effort per task: use the \`estimation\` field (hours) exactly as given — it is already the task's correct effort (the system has pre-summed subtasks where applicable, so do NOT add subtask hours yourself). Only when \`estimation\` is null, estimate it yourself from the title/description and set "assumed": true.
- Fill the day to ~7-8h total. This is a HARD CAP: the sum of the chosen items' hours MUST NOT exceed ${DAY_HARD_CAP_HOURS}h under any circumstances. Add tasks one at a time in best-first order and STOP as soon as the next task would push the total over ${DAY_HARD_CAP_HOURS}h — do not add it. Prefer a day that lands at 7-8h; never go past ${DAY_HARD_CAP_HOURS}h.
- If even the single highest-ranked task is larger than ${DAY_HARD_CAP_HOURS}h, include only that one task and explain in "note" that it spans more than one day.

Respond with EXACTLY this JSON shape and nothing else:
{
  "items": [
    { "id": <task id, number>, "title": <string>, "hours": <number>, "assumed": <boolean> }
  ],
  "focus": <short phrase naming the day's theme>,
  "totalHours": <number, the sum of item hours>,
  "note": <optional string — include ONLY if the backlog can't fill the day or a single task spans more than a day>
}

Rules: at most ${MAX_ITEMS} items, ordered best-first; "assumed" is true only when you estimated the hours yourself; "totalHours" MUST equal the sum of the items' hours and MUST be <= ${DAY_HARD_CAP_HOURS}. Output nothing but the JSON object.`;

/** All tools this agent is allowed to call. */
const TOOL_NAMES = ["list_tasks", "get_task"] as const;

// ─── Response schema (precise) ──────────────────────────────────────────────────

export const planItemSchema = z.object({
  id: z.coerce.number(),
  title: z.string(),
  hours: z.coerce.number().nonnegative(),
  assumed: z.boolean().optional().default(false),
});

export const prioritizationPlanSchema = z.object({
  items: z.array(planItemSchema),
  focus: z.string().optional(),
  totalHours: z.coerce.number().optional(),
  note: z.string().optional(),
});

export type PrioritizationPlan = z.infer<typeof prioritizationPlanSchema>;
export type PlanItem = z.infer<typeof planItemSchema>;

export interface PrioritizationResult extends AgentResult {
  /** The model's raw `output`, parsed, validated, and clamped to the day budget. */
  plan: PrioritizationPlan;
}

/**
 * Enforces the day budget regardless of what the model returned: keeps items in
 * best-first order while the running total stays within the hard cap, always
 * keeps at least one item, and recomputes `totalHours` from the kept items.
 */
function enforceDayBudget(plan: PrioritizationPlan): PrioritizationPlan {
  const kept: PlanItem[] = [];
  let total = 0;

  for (const item of plan.items) {
    if (kept.length >= MAX_ITEMS) break;
    // Always keep the top-ranked item so the day is never empty; otherwise only
    // add an item if it doesn't push the day past the hard cap.
    if (kept.length === 0 || total + item.hours <= DAY_HARD_CAP_HOURS) {
      kept.push(item);
      total += item.hours;
      if (total >= DAY_HARD_CAP_HOURS) break;
    }
  }

  const totalHours = round1(kept.reduce((sum, i) => sum + i.hours, 0));
  const trimmed = kept.length < plan.items.length;
  const overflow = totalHours > DAY_HARD_CAP_HOURS; // only possible if a single task exceeds the cap

  let note = plan.note;
  if (overflow) {
    note = `Top task is ${totalHours}h — it spans more than one day.`;
  } else if (trimmed && !note) {
    note = `Trimmed to fit a ~7-8h day (${plan.items.length - kept.length} lower-priority task(s) deferred).`;
  }

  return { ...plan, items: kept, totalHours, ...(note ? { note } : {}) };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Safe plan used only when the model output can't be parsed at all. */
const EMPTY_PLAN: PrioritizationPlan = {
  items: [],
  focus: "No plan available",
  totalHours: 0,
  note: "Couldn't produce a plan this time — please try again.",
};

export async function runPrioritizationAgent(
  registry: ToolRegistry,
): Promise<PrioritizationResult> {
  const today = new Date().toISOString();

  const result = await runAgent({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: `Today is ${today}. Using the tools, work out exactly what the team should do today and in what order. Reason silently — do not narrate your thinking. Reply with ONLY the single JSON object specified in your instructions: no markdown, no code fences, no text before or after it.`,
    toolNames: [...TOOL_NAMES],
    registry,
  });

  const parsed = parseLastValidJson(result.output, prioritizationPlanSchema);
  if (!parsed) {
    logger.warn({ output: result.output }, "Prioritization agent returned no valid JSON plan");
  }
  const plan = parsed ? enforceDayBudget(parsed) : EMPTY_PLAN;

  // Re-serialize the corrected plan into `output` so existing consumers that
  // parse the raw string still get the budget-clamped result.
  return { ...result, output: JSON.stringify(plan), plan };
}
