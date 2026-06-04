import type { FunctionDeclaration } from "@google/generative-ai";

export type ToolExecutor = (args: Record<string, unknown>) => Promise<unknown>;

export interface RegisteredTool {
  declaration: FunctionDeclaration;
  execute: ToolExecutor;
}

/**
 * A simple name-keyed registry of tools available to the agent runner.
 * Agents declare which tool names they use; the runner looks them up here.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool): this {
    this.tools.set(tool.declaration.name, tool);
    return this;
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  declarations(names: string[]): FunctionDeclaration[] {
    return names
      .map((n) => this.tools.get(n)?.declaration)
      .filter((d): d is FunctionDeclaration => d !== undefined);
  }
}
