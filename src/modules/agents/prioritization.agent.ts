import { runAgent, type AgentResult } from "./core/agent-runner";
import type { ToolRegistry } from "./core/tool-registry";

const SYSTEM_PROMPT = `You are a senior engineering team lead producing a "start-your-day" plan for a single 7-8 hour working day.

Reason SILENTLY using the tools, then respond with ONLY a single JSON object — no markdown, no code fences, no prose before or after it.

How to think (internally, do not output):
- Call list_tasks; if an item lacks detail, call get_task before finalizing.
- Rank non-done tasks by urgency (priority high>medium>low, plus age), momentum (prefer in-progress unless stalled), and impact (high-priority unblockers first).
- Effort per task: use the \`estimation\` field (hours) exactly as given — it is already the task's correct effort (the system has pre-summed subtasks where applicable, so do NOT add subtask hours yourself). Only when \`estimation\` is null, estimate it yourself from the title/description and set "assumed": true.
- Fill the day to ~7-8h total (never exceed ~8h); pick the highest-ranked tasks until you hit the budget.

Respond with EXACTLY this JSON shape and nothing else:
{
  "items": [
    { "id": <task id, number>, "title": <string>, "hours": <number>, "assumed": <boolean> }
  ],
  "focus": <short phrase naming the day's theme>,
  "totalHours": <number, the sum of item hours>,
  "note": <optional string — include ONLY if the backlog can't fill the day or overflows ~8h>
}

Rules: at most 7 items, ordered best-first; "assumed" is true only when you estimated the hours yourself; "totalHours" must equal the sum of the items' hours. Output nothing but the JSON object.`;

/** All tools this agent is allowed to call. */
const TOOL_NAMES = ["list_tasks", "get_task"] as const;

export interface PrioritizationResult extends AgentResult {
  // output is a single JSON object string (see SYSTEM_PROMPT shape), parsed by the FE
}

export async function runPrioritizationAgent(
  registry: ToolRegistry,
): Promise<PrioritizationResult> {
  const today = new Date().toISOString();

  return runAgent({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: `Today is ${today}. Using the tools, work out exactly what the team should do today and in what order. Reason silently — do not narrate your thinking. Reply with ONLY the single JSON object specified in your instructions: no markdown, no code fences, no text before or after it.`,
    toolNames: [...TOOL_NAMES],
    registry,
  });
}
