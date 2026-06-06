import { z } from "zod";
import { runAgent, type AgentResult } from "./core/agent-runner";
import type { ToolRegistry } from "./core/tool-registry";
import { parseLastValidJson } from "./core/parse-json-response";
import { logger } from "../../shared/logger";

const SYSTEM_PROMPT = `You are a senior software engineer acting as a task decomposition agent.

Your job is to break an engineering task down into concrete, implementable subtasks.

Reason SILENTLY using the tools, then respond with ONLY a single JSON object — no markdown, no code fences, no prose before or after it.

How to think (internally, do not output):
1. If given a taskId, call get_task to fetch full details before doing anything else.
2. If given a taskId, also call list_tasks with parentId set to that taskId to retrieve the subtasks that already exist. Count them and read their titles. You MUST take them into account:
   - Never duplicate an existing subtask. Only propose subtasks that cover work not already represented.
   - If the task already looks fully decomposed (existing subtasks cover the whole scope), return an empty "subtasks" array and explain it in "note" rather than inventing redundant work.
   - When you do propose new subtasks, they should complement the existing ones, not overlap them.
3. Assess whether the task has enough detail to decompose:
   - Clear task: title + description explain what needs to be built, how, and for whom.
   - Vague task: title is a single vague phrase (e.g. "fix the auth"), no description, or the description raises more questions than it answers.

Decide which ONE of these two responses to return, and output EXACTLY that JSON shape and nothing else:

VAGUE — do NOT guess. Ask exactly one specific question that, if answered, makes the task actionable:
{
  "status": "needs_clarification",
  "question": <string — one targeted question>
}

CLEAR — generate 3-7 NEW subtasks (fewer if most of the work already exists as subtasks). Each subtask must be independently implementable, testable, and small enough for a single engineer to complete in one session:
{
  "status": "decomposed",
  "subtasks": [
    {
      "title": <string — MUST begin with a role prefix in square brackets: [FE], [BE], [DevOps], or [QA]; e.g. "[BE] Create Message entity">,
      "description": <string — include acceptance criteria>,
      "estimation": <number — estimated effort in hours>
    }
  ],
  "note": <optional string — include ONLY to explain an empty subtasks array (e.g. already fully decomposed)>
}

Rules:
- Choose the single most appropriate role prefix per subtask based on who would do the work — frontend, backend, infrastructure/CI, or testing.
- Do not add management overhead (e.g. "Update JIRA ticket") — only engineering work items.
- "estimation" is a number of hours, not a string.
- Output nothing but the single JSON object.`;

export const decompositionSubtaskSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  estimation: z.coerce.number().nonnegative(),
});

export const decompositionResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("needs_clarification"),
    question: z.string().min(1),
  }),
  z.object({
    status: z.literal("decomposed"),
    subtasks: z.array(decompositionSubtaskSchema),
    note: z.string().optional(),
  }),
]);

export type DecompositionResponse = z.infer<typeof decompositionResponseSchema>;
export type DecompositionSubtask = z.infer<typeof decompositionSubtaskSchema>;

export interface DecomposeInput {
  taskId?: number;
  title?: string;
  description?: string;
  persist?: boolean;
  clarification?: string;
}

export interface DecomposeResult extends AgentResult {
  decomposition: DecompositionResponse;
}

const TOOL_NAMES_READ = ["get_task", "list_tasks"] as const;
const TOOL_NAMES_WRITE = ["get_task", "list_tasks", "create_subtasks"] as const;

/**
 * Non-destructive fallback used only when the model output can't be parsed into
 * a valid response. Never persists work; just asks the caller to retry.
 */
const FALLBACK_RESPONSE: DecompositionResponse = {
  status: "needs_clarification",
  question:
    "I couldn't break this down reliably. Could you add a bit more detail about what needs to be built and for whom?",
};

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
  parts.push(
    `\nReason silently — do not narrate your thinking. Reply with ONLY the single JSON object specified in your instructions: no markdown, no code fences, no text before or after it.`,
  );

  const toolNames = input.persist
    ? [...TOOL_NAMES_WRITE]
    : [...TOOL_NAMES_READ];

  const result = await runAgent({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: parts.join("\n"),
    toolNames,
    registry,
  });

  const decomposition = parseLastValidJson(result.output, decompositionResponseSchema);
  if (!decomposition) {
    logger.warn({ output: result.output }, "Decomposition agent returned no valid JSON response");
  }
  return { ...result, decomposition: decomposition ?? FALLBACK_RESPONSE };
}
