import Anthropic from "@anthropic-ai/sdk";
import type { FunctionDeclaration, Schema } from "@google/generative-ai";
import { env } from "../../../config/env";

export const CLAUDE_MODEL = "claude-haiku-4-5-20251001";

let _client: Anthropic | undefined;

/** Lazy-initialised Anthropic client. Throws if key is missing. */
export function getAnthropic(): Anthropic {
  _client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _client;
}

export function isClaudeAvailable(): boolean {
  return !!env.ANTHROPIC_API_KEY;
}

// ── Schema conversion (Gemini FunctionDeclaration → Anthropic Tool) ───────────

function schemaToJsonSchema(schema: Schema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (schema.type) out.type = schema.type; // SchemaType values are already lowercase strings
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.format) out.format = schema.format;
  if (schema.nullable !== undefined) out.nullable = schema.nullable;
  if (schema.items) out.items = schemaToJsonSchema(schema.items);
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, schemaToJsonSchema(v)]),
    );
  }
  if (schema.required?.length) out.required = schema.required;
  return out;
}

/**
 * Converts Gemini FunctionDeclarations to the Anthropic Tool format.
 * The `input_schema` must be a JSON Schema object with `type: "object"`.
 */
export function toAnthropicTools(declarations: FunctionDeclaration[]): Anthropic.Tool[] {
  return declarations.map((decl) => {
    const paramSchema = decl.parameters ? schemaToJsonSchema(decl.parameters) : {};
    return {
      name: decl.name,
      description: decl.description ?? "",
      input_schema: {
        type: "object" as const,
        properties: (paramSchema.properties as Record<string, unknown>) ?? {},
        ...(Array.isArray(paramSchema.required) ? { required: paramSchema.required as string[] } : {}),
      },
    };
  });
}
