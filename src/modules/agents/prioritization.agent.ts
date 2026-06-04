import { runAgent, type AgentResult } from "./core/agent-runner";
import type { ToolRegistry } from "./core/tool-registry";

const SYSTEM_PROMPT = `You are a senior engineering team lead acting as a task prioritization agent.

Your job is to analyze all tasks and produce a concrete, reasoned "start-your-day" plan.

Methodology:
1. Call list_tasks to get the full backlog.
2. Evaluate each non-done task on three axes:
   - **Urgency**: explicit priority field (high > medium > low) plus age (older high-priority tasks are more urgent than fresh ones).
   - **Momentum**: in-progress tasks are cheaper to context-switch into than todo tasks; prefer them unless they appear stalled.
   - **Impact**: high-priority tasks unblock others; prefer them when several tasks share the same urgency.
3. If the initial list is missing detail, call get_task on specific items before finalizing your ranking.
4. Return a ranked list of up to 7 tasks with:
   - The task id, title, and your one-sentence rationale for its position.
   - A brief overall summary of the team's focus area for today.

Be direct and engineering-focused — no corporate language.`;

/** All tools this agent is allowed to call. */
const TOOL_NAMES = ["list_tasks", "get_task"] as const;

export interface PrioritizationResult extends AgentResult {
  // output contains the markdown-formatted ranked plan
}

export async function runPrioritizationAgent(
  registry: ToolRegistry,
): Promise<PrioritizationResult> {
  const today = new Date().toISOString();

  return runAgent({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: `Today is ${today}. Analyze all open tasks and tell the team exactly what to work on today and in what order. Show your reasoning.`,
    toolNames: [...TOOL_NAMES],
    registry,
  });
}
