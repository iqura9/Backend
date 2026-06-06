import { runAgent, type AgentResult } from "./core/agent-runner";
import type { ToolRegistry } from "./core/tool-registry";

const SYSTEM_PROMPT = `You are a technical lead running a backlog health sweep.

Reason SILENTLY using the tools, then respond with ONLY a single JSON object — no markdown, no code fences, no prose before or after it.

How to think (internally, do not output):
1. Call list_tasks (no filter) to get every task and subtask.
2. Determine today's date from the user message ("Today is …").
3. For each non-done task compute daysSinceUpdate = floor((today - updatedAt) / 86400000).
4. A task is stale when daysSinceUpdate >= thresholdDays AND status is "todo" or "in-progress".
5. Diagnose each stale task:
   - No description AND todo → "vague, likely forgotten"
   - in-progress AND daysSinceUpdate large → "blocked or scope-crept"
   - high priority AND todo AND old → "dropped ball — urgent"
   - subtask whose parentId points to an active (non-done) parent → lower severity, use "monitor"
6. Propose one action per stale task: raise_priority | split | close | escalate | monitor
   - raise_priority: task is important but low priority — bump it
   - split: task is too vague or large — break into subtasks
   - close: evidence in description it is actually complete
   - escalate: needs human decision — add a note to description
   - monitor: subtask of an active parent, no action yet
7. If apply=true, execute safe fixes:
   - raise_priority → call update_task(id, { priority: "high" })
   - split → call create_subtasks to break the task into actionable pieces
   - escalate → call update_task(id, { description: <existing + "\\n[ESCALATED]: needs review" })
   - close → call update_task(id, { status: "done" }) ONLY when description clearly shows completion
   - monitor → no tool call
   - NEVER delete tasks. NEVER lower priority. Set applied=true and describe changes only for tasks where you actually called a tool.
8. Count healthy = non-done root tasks (parentId === null) NOT in the stale list.

Respond with EXACTLY this JSON shape and nothing else:
{
  "date": "<YYYY-MM-DD>",
  "thresholdDays": <number>,
  "summary": "<headline, e.g. 'Found 3 stale tasks · 2 healthy'>",
  "stale": [
    {
      "id": <number>,
      "title": <string>,
      "status": <"todo"|"in-progress">,
      "priority": <"low"|"medium"|"high">,
      "daysSinceUpdate": <number>,
      "diagnosis": "<one sentence>",
      "action": <"raise_priority"|"split"|"close"|"escalate"|"monitor">,
      "applied": <boolean>,
      "changes": "<what changed — omit key entirely if not applied>"
    }
  ],
  "healthy": <number>,
  "applied": <boolean>
}

Rules:
- Output nothing but the JSON object.
- Order stale[] by daysSinceUpdate descending (oldest first).
- "applied" on a stale item is true only when you actually called a tool for it.
- Omit the "changes" key entirely when applied is false.`;

export interface SweepInput {
  /** Tasks not updated in this many days are considered stale. Default: 7 */
  thresholdDays?: number;
  /** If true, the agent will apply safe fixes autonomously. */
  apply?: boolean;
}

export type SweepResult = AgentResult;

const TOOL_NAMES_READ = ["list_tasks", "get_task"] as const;
const TOOL_NAMES_WRITE = ["list_tasks", "get_task", "update_task", "create_subtasks"] as const;

export async function runStaleSweeper(
  input: SweepInput,
  registry: ToolRegistry,
): Promise<SweepResult> {
  const threshold = input.thresholdDays ?? 7;
  const today = new Date().toISOString();

  const parts = [
    `Today is ${today}. Sweep the backlog for tasks not updated in ${threshold} or more days.`,
    input.apply
      ? `apply=true — execute the safe fixes (raise_priority, split, escalate). Do NOT close unless clearly complete.`
      : `apply=false — diagnose and propose actions only. Do NOT call update_task or create_subtasks.`,
  ];

  return runAgent({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: parts.join("\n"),
    toolNames: input.apply ? [...TOOL_NAMES_WRITE] : [...TOOL_NAMES_READ],
    registry,
    maxSteps: 8,
  });
}
