import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

// ─── Reusable enums ───────────────────────────────────────────────────────────

export const statusSchema = z
  .enum(["todo", "in-progress", "done"])
  .openapi({ example: "todo", description: "Lifecycle state of the task" });

export const prioritySchema = z
  .enum(["low", "medium", "high"])
  .openapi({ example: "medium", description: "Business priority of the task" });

// ─── Response schema (what the API returns) ───────────────────────────────────

export const taskResponseSchema = z
  .object({
    id: z.number().int().positive(),
    parentId: z.number().int().positive().nullable(),
    title: z.string(),
    description: z.string(),
    status: statusSchema,
    priority: prioritySchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("Task");

// ─── Body schemas ─────────────────────────────────────────────────────────────

export const createTaskSchema = z
  .object({
    title: z
      .string()
      .min(1, "Title is required")
      .max(255, "Title too long")
      .openapi({ example: "Implement JWT authentication" }),
    description: z
      .string()
      .max(10_000)
      .optional()
      .openapi({ example: "Add JWT-based auth to the REST API using RS256" }),
    status: statusSchema.optional(),
    priority: prioritySchema.optional(),
    parentId: z
      .number()
      .int()
      .positive()
      .optional()
      .openapi({ description: "ID of the parent task; omit for top-level tasks" }),
  })
  .openapi("CreateTaskInput");

export const updateTaskSchema = z
  .object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().max(10_000).optional(),
    status: statusSchema.optional(),
    priority: prioritySchema.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field must be provided",
  })
  .openapi("UpdateTaskInput");

// ─── Query schema ─────────────────────────────────────────────────────────────

export const taskQuerySchema = z.object({
  status: statusSchema.optional(),
  priority: prioritySchema.optional(),
  /** Pass `"null"` to get top-level tasks only; a numeric string to get subtasks of that parent. */
  parentId: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      if (v === "null") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    }),
  sortBy: z.enum(["priority", "createdAt"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});
