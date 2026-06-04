import { runAgent, type AgentResult } from "./core/agent-runner";
import type { ToolRegistry } from "./core/tool-registry";

const SYSTEM_PROMPT = `You are a senior software engineer acting as a task decomposition agent.

Your job is to break an engineering task down into concrete, implementable subtasks.

Workflow:
1. If given a taskId, call get_task to fetch full details before doing anything else.
2. Assess whether the task has enough detail to decompose:
   - Clear task: title + description explain what needs to be built, how, and for whom.
   - Vague task: title is a single vague phrase (e.g. "fix the auth"), no description, or the description raises more questions than it answers.
3. If the task is VAGUE:
   - Do NOT guess. Respond with a JSON object: { "status": "needs_clarification", "question": "<your targeted question>" }.
   - Ask exactly one specific question that, if answered, makes the task actionable.
4. If the task is CLEAR:
   - Generate 3–7 subtasks. Each subtask must be independently implementable, testable, and small enough for a single engineer to complete in one session.
   - Include acceptance criteria in each subtask description.
   - If the caller set persist=true, call create_subtasks to write them to the database.
   - Otherwise, just describe them without persisting.

Output format when clear: JSON with { "status": "decomposed", "subtasks": [{ "title", "description", "priority" }] }.

Do not add management overhead (e.g. "Update JIRA ticket") — only engineering work items.`;

export interface DecomposeInput {
  taskId?: number;
  title?: string;
  description?: string;
  persist?: boolean;
  /** Clarification provided by the user in a follow-up call */
  clarification?: string;
}

export interface DecomposeResult extends AgentResult {
  // output is JSON: { status: "decomposed" | "needs_clarification", ... }
}

const TOOL_NAMES_READ = ["get_task"] as const;
const TOOL_NAMES_WRITE = ["get_task", "create_subtasks"] as const;

export async function runDecompositionAgent(
  input: DecomposeInput,
  registry: ToolRegistry,
): Promise<DecomposeResult> {
  const parts: string[] = [];

  if (input.taskId !== undefined) {
    parts.push(`Task ID: ${input.taskId}`);
  }
  if (input.title) {
    parts.push(`Title: ${input.title}`);
  }
  if (input.description) {
    parts.push(`Description: ${input.description}`);
  }
  if (input.clarification) {
    parts.push(`\nAdditional context from the user: "${input.clarification}"`);
  }
  if (input.persist) {
    parts.push(`\nThe user has confirmed: persist=true — call create_subtasks to save them.`);
  } else {
    parts.push(`\npersist=false — describe the subtasks but do NOT call create_subtasks.`);
  }

  const toolNames = input.persist ? [...TOOL_NAMES_WRITE] : [...TOOL_NAMES_READ];

  return runAgent({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: parts.join("\n"),
    toolNames,
    registry,
  });
}
