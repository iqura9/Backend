import { runAgent, type AgentResult } from "./core/agent-runner";
import type { ToolRegistry } from "./core/tool-registry";

/**
 * Custom agent D — Stale Task Sweeper.
 *
 * Why this is useful for engineering teams:
 * Neglected tickets ("zombie tasks") are a silent killer of eng throughput.
 * They clog the backlog, mislead planning estimates, and signal unresolved blockers.
 * This agent proactively identifies tasks that have been stuck without progress,
 * reasons about why they might be stale (scope too large, forgotten, blocked),
 * proposes a concrete action for each (bump priority, split, mark done, close),
 * and — when apply=true — performs the safe updates autonomously.
 * It replaces recurring manual backlog grooming for small-to-medium teams.
 */

const SYSTEM_PROMPT = `You are a technical lead running a backlog health sweep.

Your goal: identify stale tasks, diagnose why they are stuck, and propose (or apply) fixes.

Definition of "stale":
- Status is 'todo' or 'in-progress'
- AND the task has not been updated within the threshold (default: 7 days)
- Subtasks of an active parent are less urgently stale — note them but lower their severity.

Workflow:
1. Call list_tasks (no filter) to fetch all tasks.
2. For each non-done task, check its updatedAt against today's date and the threshold.
3. For each stale task, diagnose the likely reason from title/description/status:
   - "No description" → probably forgotten or too vague.
   - "In-progress for >threshold" → likely blocked or scope-crept.
   - "Todo, high-priority, old" → dropped ball — needs urgent attention.
4. Propose one of: raise_priority, split (create subtasks to clarify scope), close (mark done), or escalate (leave a note).
5. If apply=true:
   - For raise_priority: call update_task(id, { priority: "high" }).
   - For close: call update_task(id, { status: "done" }) ONLY if you're confident from the description it's actually complete.
   - For split: call create_subtasks to break the vague task into actionable pieces.
   - For escalate: add a note to the description via update_task.
   - NEVER delete tasks. NEVER lower priority unless explicitly justified.
6. Return a structured report: list of stale tasks with diagnosis, proposed action, and (if applied) what was changed.`;

export interface SweepInput {
  /** Tasks not updated in this many days are considered stale. Default: 7 */
  thresholdDays?: number;
  /** If true, the agent will actually apply safe updates. */
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
    `Today is ${today}. Sweep the backlog for tasks that have not been updated in ${threshold} or more days.`,
  ];

  if (input.apply) {
    parts.push(
      `apply=true — perform the safe updates (raise_priority, split, escalate). Do NOT close tasks unless you are certain they are complete.`,
    );
  } else {
    parts.push(
      `apply=false — diagnose and propose actions, but do NOT modify any tasks. Just return your report.`,
    );
  }

  const toolNames = input.apply ? [...TOOL_NAMES_WRITE] : [...TOOL_NAMES_READ];

  return runAgent({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: parts.join("\n"),
    toolNames,
    registry,
    maxSteps: 8, // May need more rounds on large backlogs
  });
}
