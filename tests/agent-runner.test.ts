import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// ─── Mock env + gemini.client before importing agent-runner ───────────────────

// A Gemini key must be present for the runner to take the Gemini path; Claude is
// left unconfigured so the test exercises the primary provider deterministically.
vi.mock("../src/config/env", () => ({
  env: {
    NODE_ENV: "test",
    PORT: 3001,
    LOG_LEVEL: "silent",
    GEMINI_API_KEY: "test-key",
    ANTHROPIC_API_KEY: undefined,
    AI_MODELS: ["gemini-test-model"],
    AI_PROVIDER_PRIORITY: "gemini",
    DB_PATH: ":memory:",
  },
}));

vi.mock("../src/modules/agents/core/gemini.client", () => ({
  getModel: vi.fn(),
  getAvailableModels: vi.fn(async () => ["gemini-test-model"]),
}));

import { runAgent } from "../src/modules/agents/core/agent-runner";
import { ToolRegistry } from "../src/modules/agents/core/tool-registry";
import { getModel } from "../src/modules/agents/core/gemini.client";
import { AgentError } from "../src/shared/errors";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type MockPart = { text: string } | { functionCall: { name: string; args: object } };

/** Builds a fake Gemini model that replays the given sequence of responses. */
function mockModel(responses: MockPart[][]) {
  let callIndex = 0;

  const sendMessage: Mock = vi.fn(async () => {
    const parts: MockPart[] = responses[callIndex++] ?? [];

    return {
      response: {
        candidates: [{ content: { parts } }],
        text: () => {
          const textPart = parts.find((p): p is { text: string } => "text" in p);
          return textPart?.text ?? "";
        },
      },
    };
  });

  const startChat = vi.fn(() => ({ sendMessage }));
  return { startChat, sendMessage };
}

function buildRegistry(...toolNames: string[]): ToolRegistry {
  const registry = new ToolRegistry();
  for (const name of toolNames) {
    registry.register({
      declaration: {
        name,
        description: `Test tool: ${name}`,
        parameters: { type: "OBJECT" as never, properties: {}, required: [] },
      },
      execute: vi.fn(async () => ({ result: `${name}_result` })),
    });
  }
  return registry;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runAgent — no tool calls", () => {
  it("returns text immediately when the model emits no function calls", async () => {
    const model = mockModel([[{ text: "Here is my analysis." }]]);
    (getModel as Mock).mockReturnValue(model);

    const result = await runAgent({
      systemPrompt: "You are helpful.",
      userMessage: "What should I do?",
      toolNames: [],
      registry: buildRegistry(),
    });

    expect(result.output).toBe("Here is my analysis.");
    expect(result.steps).toHaveLength(0);
    expect(result.model).toBe("gemini-test-model");
  });
});

describe("runAgent — tool-calling loop", () => {
  it("executes a function call and feeds the response back before returning text", async () => {
    const model = mockModel([
      // Round 1: model wants to call a tool
      [{ functionCall: { name: "list_tasks", args: {} } }],
      // Round 2: model produces final text after seeing the tool result
      [{ text: "Based on the tasks, here is my recommendation." }],
    ]);
    (getModel as Mock).mockReturnValue(model);

    const registry = buildRegistry("list_tasks");
    const listTasksTool = registry.get("list_tasks")!;

    const result = await runAgent({
      systemPrompt: "You are a prioritization agent.",
      userMessage: "Prioritize my tasks.",
      toolNames: ["list_tasks"],
      registry,
    });

    expect(listTasksTool.execute).toHaveBeenCalledOnce();
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].tool).toBe("list_tasks");
    expect(result.steps[0].result).toEqual({ result: "list_tasks_result" });
    expect(result.output).toBe("Based on the tasks, here is my recommendation.");

    // sendMessage called twice: once for the user prompt, once with the function response
    expect(model.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("handles multiple tool calls in a single round", async () => {
    const model = mockModel([
      [
        { functionCall: { name: "tool_a", args: { id: 1 } } },
        { functionCall: { name: "tool_b", args: {} } },
      ],
      [{ text: "Done." }],
    ]);
    (getModel as Mock).mockReturnValue(model);

    const registry = buildRegistry("tool_a", "tool_b");
    const result = await runAgent({
      systemPrompt: "Agent",
      userMessage: "Go.",
      toolNames: ["tool_a", "tool_b"],
      registry,
    });

    expect(result.steps).toHaveLength(2);
    expect(result.steps.map((s) => s.tool)).toEqual(["tool_a", "tool_b"]);
  });

  it("runs multiple rounds until the model stops calling tools", async () => {
    const model = mockModel([
      [{ functionCall: { name: "step1", args: {} } }],
      [{ functionCall: { name: "step2", args: {} } }],
      [{ text: "Final answer." }],
    ]);
    (getModel as Mock).mockReturnValue(model);

    const registry = buildRegistry("step1", "step2");
    const result = await runAgent({
      systemPrompt: "Agent",
      userMessage: "Run multi-step.",
      toolNames: ["step1", "step2"],
      registry,
    });

    expect(result.steps).toHaveLength(2);
    expect(result.output).toBe("Final answer.");
  });
});

describe("runAgent — error handling", () => {
  it("throws AgentError when maxSteps is exceeded", async () => {
    // Model always returns a function call, never text → should hit maxSteps
    const infiniteResponses = Array.from({ length: 10 }, () => [
      { functionCall: { name: "infinite_tool", args: {} } },
    ]);
    const model = mockModel(infiniteResponses);
    (getModel as Mock).mockReturnValue(model);

    await expect(
      runAgent({
        systemPrompt: "Agent",
        userMessage: "Loop forever.",
        toolNames: ["infinite_tool"],
        registry: buildRegistry("infinite_tool"),
        maxSteps: 3,
      }),
    ).rejects.toThrow(AgentError);
  });

  it("returns an error result (not throw) when a tool execution fails", async () => {
    const model = mockModel([
      [{ functionCall: { name: "broken_tool", args: {} } }],
      [{ text: "I handled the error." }],
    ]);
    (getModel as Mock).mockReturnValue(model);

    const registry = buildRegistry("broken_tool");
    vi.mocked(registry.get("broken_tool")!.execute).mockRejectedValue(new Error("DB exploded"));

    const result = await runAgent({
      systemPrompt: "Agent",
      userMessage: "Try the tool.",
      toolNames: ["broken_tool"],
      registry,
    });

    expect(result.steps[0].result).toEqual({ error: "DB exploded" });
    // Agent still completes — Gemini sees the error and responds gracefully
    expect(result.output).toBe("I handled the error.");
  });

  it("rejects unauthorized tool use gracefully", async () => {
    const model = mockModel([
      [{ functionCall: { name: "secret_tool", args: {} } }],
      [{ text: "OK, I skipped it." }],
    ]);
    (getModel as Mock).mockReturnValue(model);

    // "secret_tool" exists in registry but is NOT in toolNames
    const registry = buildRegistry("secret_tool");
    const result = await runAgent({
      systemPrompt: "Agent",
      userMessage: "Use the secret tool.",
      toolNames: [], // not granted
      registry,
    });

    expect(result.steps[0].result).toEqual(
      expect.objectContaining({ error: expect.stringContaining("not available") }),
    );
  });
});
