import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  GEMINI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Comma-separated ordered list of Gemini model names to try (first = preferred). */
  AI_MODELS: z
    .string()
    .default("gemini-2.5-flash,gemini-2.0-flash,gemini-1.5-flash")
    .transform((s) => s.split(",").map((m) => m.trim()).filter(Boolean)),
  DB_PATH: z.string().default("data/devlog.db"),
});

function loadEnv() {
  const result = schema.safeParse(process.env);

  if (!result.success) {
    console.error("❌  Invalid environment configuration:\n");
    for (const [field, messages] of Object.entries(
      result.error.flatten().fieldErrors,
    )) {
      console.error(`  ${field}: ${messages?.join(", ")}`);
    }
    process.exit(1);
  }

  return Object.freeze(result.data);
}

export const env = loadEnv();
export type Env = typeof env;
