import { runAgent, type AgentResult } from "./core/agent-runner";
import type { ToolRegistry } from "./core/tool-registry";

const SYSTEM_PROMPT = `You are a staff engineer composing async team status updates.

Your updates appear in the team's Slack channel — teammates read them without asking follow-ups.

Rules:
1. Call get_task to fetch the task. Then call list_tasks with the task's id as parentId to get its subtasks.
2. Write a short, scannable update:
   - One header line: "✅ Done" / "🔄 In Progress" / "📋 Todo" — matching task status.
   - Bullet points: what was completed, what's active, what's next.
   - If there are subtasks, reflect their statuses accurately.
   - Max 5 bullets. No filler phrases ("I've been working hard on…").
3. Adapt tone to task type:
   - Hotfix/bug → brief and factual.
   - Feature → can include one "why this matters" line.
   - Chore/infra → pure facts, no narrative.
4. If the caller provides notes, weave them in naturally.
5. Do NOT mention task IDs in the final update.`;

export interface StatusUpdateInput {
  taskId: number;
  notes?: string;
  tone?: "technical" | "casual" | "formal";
}

export type StatusUpdateResult = AgentResult;

const TOOL_NAMES = ["get_task", "list_tasks"] as const;

export async function runStatusUpdateAgent(
  input: StatusUpdateInput,
  registry: ToolRegistry,
): Promise<StatusUpdateResult> {
  const parts = [
    `Generate a Slack-style status update for task ${input.taskId}.`,
  ];

  if (input.notes) {
    parts.push(`Additional notes from the engineer: "${input.notes}"`);
  }
  if (input.tone) {
    parts.push(`Requested tone: ${input.tone}`);
  }

  return runAgent({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: parts.join("\n"),
    toolNames: [...TOOL_NAMES],
    registry,
  });
}
