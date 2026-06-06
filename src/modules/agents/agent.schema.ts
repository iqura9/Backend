import { z } from "zod";

export const toolStepSchema = z.object({
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  result: z.unknown(),
});

export const agentResponseSchema = z.object({
  output: z.string(),
  model: z.string(),
  steps: z.array(toolStepSchema),
});

export const prioritizeRequestSchema = z.object({}).strict();

export const decomposeRequestSchema = z
  .object({
    /** ID of an existing task to decompose. */
    taskId: z.number().int().positive().optional(),
    /** Provide a title directly (without an existing task). */
    title: z.string().min(1).max(255).optional(),
    /** Provide a description directly. */
    description: z.string().max(10_000).optional(),
    /** If true, the agent will write subtasks to the DB. */
    persist: z.boolean().default(false),
    /** Clarification for a previous `needs_clarification` response. */
    clarification: z.string().max(1000).optional(),
  })
  .refine(
    (d) => d.taskId !== undefined || d.title !== undefined,
    { message: "Provide either taskId (to decompose an existing task) or title (for an ad-hoc decomposition)" },
  );

const planItemSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  hours: z.number(),
});

const planSchema = z.object({
  items: z.array(planItemSchema),
  focus: z.string().optional(),
  totalHours: z.number().optional(),
});

export const statusUpdateRequestSchema = z.object({
  /** Kept for backwards-compat but ignored by the agent — scoping is now date-based. */
  taskId: z.number().int().positive().optional(),
  /** The saved "Plan my day" output — enables planned-vs-actual comparison. */
  plan: planSchema.optional(),
  notes: z.string().max(2000).optional(),
  tone: z.enum(["technical", "casual", "formal"]).optional(),
});

export const sweepRequestSchema = z.object({
  thresholdDays: z.number().int().min(1).max(365).default(7),
  apply: z.boolean().default(false),
});
