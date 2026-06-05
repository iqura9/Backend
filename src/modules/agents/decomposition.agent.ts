import { runAgent, type AgentResult } from "./core/agent-runner";
import type { ToolRegistry } from "./core/tool-registry";

const SYSTEM_PROMPT = `You are a senior software engineer acting as a task decomposition agent.

Your job is to break an engineering task down into concrete, implementable subtasks.

Workflow:
1. If given a taskId, call get_task to fetch full details before doing anything else.
2. If given a taskId, also call list_tasks with parentId set to that taskId to retrieve the subtasks that already exist. Count them and read their titles. You MUST take them into account:
   - Never duplicate an existing subtask. Only propose subtasks that cover work not already represented.
   - If the task already looks fully decomposed (existing subtasks cover the whole scope), return an empty "subtasks" array and note it in the description of your reasoning rather than inventing redundant work.
   - When you do propose new subtasks, they should complement the existing ones, not overlap them.
3. Assess whether the task has enough detail to decompose:
   - Clear task: title + description explain what needs to be built, how, and for whom.
   - Vague task: title is a single vague phrase (e.g. "fix the auth"), no description, or the description raises more questions than it answers.
4. If the task is VAGUE:
   - Do NOT guess. Respond with a JSON object: { "status": "needs_clarification", "question": "<your targeted question>" }.
   - Ask exactly one specific question that, if answered, makes the task actionable.
5. If the task is CLEAR:
   - Generate 3–7 NEW subtasks (fewer if most of the work already exists as subtasks). Each subtask must be independently implementable, testable, and small enough for a single engineer to complete in one session.
   - Prefix every subtask title with the role responsible for it, in square brackets: [FE], [BE], [DevOps], or [QA] (e.g. "[BE] Create Message entity"). Choose the single most appropriate role per subtask based on who would do the work — frontend, backend, infrastructure/CI, or testing.
   - Include acceptance criteria in each subtask description, and an estimation in hours for each subtask.
   - If the caller set persist=true, call create_subtasks to write them to the database (pass title, description, and estimation for each).
   - Otherwise, just describe them without persisting.

Output format when clear: JSON with { "status": "decomposed", "subtasks": [{ "title", "description", "estimation" }] }, where each title begins with a [FE]/[BE]/[DevOps]/[QA] role prefix.

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

const TOOL_NAMES_READ = ["get_task", "list_tasks"] as const;
const TOOL_NAMES_WRITE = ["get_task", "list_tasks", "create_subtasks"] as const;

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
    parts.push(
      `\nThe user has confirmed: persist=true — call create_subtasks to save them.`,
    );
  } else {
    parts.push(
      `\npersist=false — describe the subtasks but do NOT call create_subtasks.`,
    );
  }

  const toolNames = input.persist
    ? [...TOOL_NAMES_WRITE]
    : [...TOOL_NAMES_READ];

  return runAgent({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: parts.join("\n"),
    toolNames,
    registry,
  });
}
