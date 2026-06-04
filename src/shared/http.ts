import type { Response } from "express";

/** Wrap data in a consistent envelope and send 200. */
export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>): void {
  res.json({ data, ...(meta && { meta }) });
}

/** Wrap data in a consistent envelope and send 201. */
export function created<T>(res: Response, data: T): void {
  res.status(201).json({ data });
}
