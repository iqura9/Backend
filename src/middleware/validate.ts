import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { ValidationError } from "../shared/errors";

/** Validates and replaces `req.body` with the parsed value. */
export function validateBody<T>(schema: z.ZodType<T, any, any>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(new ValidationError("Invalid request body", result.error.flatten().fieldErrors));
    }
    req.body = result.data;
    next();
  };
}

/** Validates query params, attaches result as `req.validatedQuery`. */
export function validateQuery<T>(schema: z.ZodType<T, any, any>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return next(new ValidationError("Invalid query parameters", result.error.flatten().fieldErrors));
    }
    (req as Request & { validatedQuery: T }).validatedQuery = result.data;
    next();
  };
}

export function validateParams<T>(schema: z.ZodType<T, any, any>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return next(new ValidationError("Invalid URL parameters", result.error.flatten().fieldErrors));
    }
    next();
  };
}

export const numericIdSchema = z.object({
  id: z
    .string()
    .regex(/^\d+$/, "id must be a positive integer")
    .transform(Number),
});
