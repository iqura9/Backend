import type { FunctionCallPart, FunctionResponsePart } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";
import { getModel, getAvailableModels, type ModelOptions } from "./gemini.client";
import { getAnthropic, CLAUDE_MODEL, toAnthropicTools, isClaudeAvailable } from "./claude.client";
import type { ToolRegistry } from "./tool-registry";
import { AgentError, ServiceUnavailableError } from "../../../shared/errors";
import { logger } from "../../../shared/logger";
import { env } from "../../../config/env";

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

/**
 * Generic multi-step tool-calling agent loop.
 *
 * Provider order is controlled by AI_PROVIDER_PRIORITY (default: "gemini").
 * The other provider is used as fallback. ServiceUnavailableError if neither key is set.
 */
export async function runAgent(options: AgentRunOptions): Promise<AgentResult> {
  const { systemPrompt, userMessage, toolNames, registry, modelOptions, maxSteps = 6 } = options;

  const declarations = registry.declarations(toolNames);
  const modelOpts: ModelOptions = {
    systemInstruction: systemPrompt,
    tools: declarations.length ? [{ functionDeclarations: declarations }] : [],
    ...modelOptions,
  };

  const preferClaude = env.AI_PROVIDER_PRIORITY === "claude";
  let lastError: unknown;

  async function tryGemini(): Promise<AgentResult | null> {
    if (!env.GEMINI_API_KEY) return null;

    const available = await getAvailableModels();
    if (available.length === 0) {
      logger.warn("No Gemini models available");
      return null;
    }

    const modelName = available[0];
    logger.debug({ model: modelName, available }, "Using first available Gemini model");

    try {
      return await runOnGemini(modelName, modelOpts, userMessage, registry, toolNames, maxSteps);
    } catch (err: unknown) {
      // A step-budget overflow is a deterministic agent failure, not a provider
      // outage — propagate it instead of masking it as a fallback/availability error.
      if (err instanceof AgentError) throw err;
      logger.warn(
        { model: modelName, cause: err instanceof Error ? err.message : String(err) },
        "Gemini model failed",
      );
      lastError = err;
      return null;
    }
  }

  async function tryClaude(): Promise<AgentResult | null> {
    if (!isClaudeAvailable()) return null;
    try {
      return await runOnClaude(systemPrompt, userMessage, declarations, registry, toolNames, maxSteps);
    } catch (err: unknown) {
      if (err instanceof AgentError) throw err;
      logger.warn({ cause: err instanceof Error ? err.message : String(err) }, "Claude failed");
      lastError = err;
      return null;
    }
  }

  const [primary, fallback] = preferClaude
    ? [tryClaude, tryGemini]
    : [tryGemini, tryClaude];

  const primaryResult = await primary();
  if (primaryResult) return primaryResult;

  logger.warn({ priority: env.AI_PROVIDER_PRIORITY }, "Primary provider unavailable — trying fallback");
  const fallbackResult = await fallback();
  if (fallbackResult) return fallbackResult;

  throw new ServiceUnavailableError(
    lastError
      ? "All AI providers failed. Check your API keys and model availability."
      : "AI features require GEMINI_API_KEY or ANTHROPIC_API_KEY in your .env file and a restart.",
  );
}

async function runOnGemini(
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

  logger.debug({ model: modelName, userMessage }, "Gemini agent run starting");

  let result = await chat.sendMessage(userMessage);

  for (let round = 0; round < maxSteps; round++) {
    const parts = result.response.candidates?.[0]?.content?.parts ?? [];

    const callParts = parts.filter(
      (p): p is FunctionCallPart => "functionCall" in p && p.functionCall != null,
    );

    if (callParts.length === 0) {
      const output = result.response.text();
      logger.debug({ model: modelName, rounds: round, steps: steps.length }, "Gemini agent run complete");
      return { output, steps, model: modelName };
    }

    const responseParts: FunctionResponsePart[] = [];

    for (const part of callParts) {
      const { name, args } = part.functionCall;
      const toolResult = await executeTool(registry, toolNames, name, args as Record<string, unknown>);
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

async function runOnClaude(
  systemPrompt: string,
  userMessage: string,
  declarations: ReturnType<ToolRegistry["declarations"]>,
  registry: ToolRegistry,
  toolNames: string[],
  maxSteps: number,
): Promise<AgentResult> {
  const anthropic = getAnthropic();
  const tools = toAnthropicTools(declarations);
  const steps: ToolStep[] = [];

  type MsgParam = Anthropic.MessageParam;
  const messages: MsgParam[] = [{ role: "user", content: userMessage }];

  logger.debug({ model: CLAUDE_MODEL, userMessage }, "Claude agent run starting");

  for (let round = 0; round <= maxSteps; round++) {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      ...(tools.length ? { tools } : {}),
    });

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUseBlocks.length === 0 || response.stop_reason === "end_turn") {
      const textBlock = response.content.find(
        (b): b is Anthropic.Messages.TextBlock => b.type === "text",
      );
      const output = textBlock?.text ?? "";
      logger.debug({ model: CLAUDE_MODEL, rounds: round, steps: steps.length }, "Claude agent run complete");
      return { output, steps, model: CLAUDE_MODEL };
    }

    if (round >= maxSteps) {
      throw new AgentError(`Agent exceeded maximum of ${maxSteps} tool-call rounds`, { steps });
    }

    messages.push({ role: "assistant", content: response.content as MsgParam["content"] });

    const toolResults: Array<{
      type: "tool_result";
      tool_use_id: string;
      content: string;
    }> = [];

    for (const block of toolUseBlocks) {
      const toolResult = await executeTool(
        registry,
        toolNames,
        block.name,
        block.input as Record<string, unknown>,
      );
      steps.push({ tool: block.name, args: block.input as Record<string, unknown>, result: toolResult });
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(toolResult),
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  throw new AgentError(`Agent exceeded maximum of ${maxSteps} tool-call rounds`, { steps });
}

async function executeTool(
  registry: ToolRegistry,
  toolNames: string[],
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const tool = registry.get(name);

  if (!tool) {
    logger.warn({ name }, "Agent called unknown tool");
    return { error: `Unknown tool: ${name}` };
  }
  if (!toolNames.includes(name)) {
    logger.warn({ name }, "Agent attempted to use unauthorized tool");
    return { error: `Tool '${name}' is not available in this context` };
  }
  try {
    const result = await tool.execute(args);
    logger.debug({ tool: name, args }, "Tool executed successfully");
    return result;
  } catch (err: unknown) {
    logger.warn({ tool: name, err }, "Tool execution failed");
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
