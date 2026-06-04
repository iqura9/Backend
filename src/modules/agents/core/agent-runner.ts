import type { FunctionCallPart, FunctionResponsePart } from "@google/generative-ai";
import { getModel, getModelList, type ModelOptions } from "./gemini.client";
import type { ToolRegistry } from "./tool-registry";
import { AgentError } from "../../../shared/errors";
import { logger } from "../../../shared/logger";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ToolStep {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
}

export interface AgentResult {
  output: string;
  steps: ToolStep[];
  model: string;
}

export interface AgentRunOptions {
  systemPrompt: string;
  userMessage: string;
  toolNames: string[];
  registry: ToolRegistry;
  modelOptions?: Pick<ModelOptions, "responseSchema">;
  /** Maximum tool-call rounds before the runner gives up. Default: 6. */
  maxSteps?: number;
}

// ─── Runner ───────────────────────────────────────────────────────────────────

/**
 * Generic multi-step tool-calling agent loop.
 *
 * Flow (each iteration = one "step"):
 *   1. Send message to the model.
 *   2. Collect any `functionCall` parts from the response.
 *   3. Execute each via the ToolRegistry; record the step.
 *   4. Feed back `functionResponse` parts and repeat.
 *   5. When the model returns text without function calls → done.
 *
 * Tries models from `env.AI_MODELS` in order (quota-based fallback).
 */
export async function runAgent(options: AgentRunOptions): Promise<AgentResult> {
  const {
    systemPrompt,
    userMessage,
    toolNames,
    registry,
    modelOptions,
    maxSteps = 6,
  } = options;

  const declarations = registry.declarations(toolNames);
  const modelOpts: ModelOptions = {
    systemInstruction: systemPrompt,
    tools: declarations.length ? [{ functionDeclarations: declarations }] : [],
    ...modelOptions,
  };

  const models = getModelList();
  let lastError: unknown;

  for (const modelName of models) {
    try {
      return await runOnModel(modelName, modelOpts, userMessage, registry, toolNames, maxSteps);
    } catch (err: unknown) {
      if (isQuotaError(err)) {
        logger.warn({ model: modelName }, "Model quota exceeded, trying next model");
        lastError = err;
        continue;
      }
      throw err; // Non-quota errors are re-thrown immediately
    }
  }

  throw new AgentError("All AI models exhausted (quota or rate-limit)", { lastError });
}

// ─── Internal ─────────────────────────────────────────────────────────────────

async function runOnModel(
  modelName: string,
  modelOpts: ModelOptions,
  userMessage: string,
  registry: ToolRegistry,
  toolNames: string[],
  maxSteps: number,
): Promise<AgentResult> {
  const model = getModel(modelName, modelOpts);
  const chat = model.startChat();
  const steps: ToolStep[] = [];

  logger.debug({ model: modelName, userMessage }, "Agent run starting");

  let result = await chat.sendMessage(userMessage);

  for (let round = 0; round < maxSteps; round++) {
    const parts = result.response.candidates?.[0]?.content?.parts ?? [];

    // Collect function calls emitted by the model
    const callParts = parts.filter(
      (p): p is FunctionCallPart => "functionCall" in p && p.functionCall != null,
    );

    if (callParts.length === 0) {
      // Model returned text — we're done
      const output = result.response.text();
      logger.debug({ model: modelName, rounds: round, steps: steps.length }, "Agent run complete");
      return { output, steps, model: modelName };
    }

    // Execute each tool call and collect responses
    const responseParts: FunctionResponsePart[] = [];

    for (const part of callParts) {
      const { name, args } = part.functionCall;
      const tool = registry.get(name);

      let toolResult: unknown;
      if (!tool) {
        toolResult = { error: `Unknown tool: ${name}` };
        logger.warn({ name }, "Agent called unknown tool");
      } else if (!toolNames.includes(name)) {
        // Tool exists in registry but was not granted to this agent
        toolResult = { error: `Tool '${name}' is not available in this context` };
        logger.warn({ name }, "Agent attempted to use unauthorized tool");
      } else {
        try {
          toolResult = await tool.execute(args as Record<string, unknown>);
          logger.debug({ tool: name, args }, "Tool executed successfully");
        } catch (err: unknown) {
          toolResult = { error: err instanceof Error ? err.message : String(err) };
          logger.warn({ tool: name, err }, "Tool execution failed");
        }
      }

      steps.push({ tool: name, args: args as Record<string, unknown>, result: toolResult });
      responseParts.push({ functionResponse: { name, response: { result: toolResult } } });
    }

    result = await chat.sendMessage(responseParts);
  }

  throw new AgentError(
    `Agent exceeded maximum of ${maxSteps} tool-call rounds without producing output`,
    { steps },
  );
}

function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    msg.includes("resource_exhausted") ||
    (err as unknown as { status?: number }).status === 429 ||
    (err as unknown as { status?: number }).status === 403
  );
}
