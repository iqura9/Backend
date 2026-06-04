import type { Request, Response, NextFunction } from "express";
import type { ToolRegistry } from "./core/tool-registry";
import { runPrioritizationAgent } from "./prioritization.agent";
import { runDecompositionAgent } from "./decomposition.agent";
import { runStatusUpdateAgent } from "./status-update.agent";
import { runStaleSweeper } from "./stale-sweeper.agent";
import type {
  decomposeRequestSchema,
  statusUpdateRequestSchema,
  sweepRequestSchema,
} from "./agent.schema";
import type { z } from "zod";
import { ok } from "../../shared/http";

type DecomposeBody = z.infer<typeof decomposeRequestSchema>;
type StatusUpdateBody = z.infer<typeof statusUpdateRequestSchema>;
type SweepBody = z.infer<typeof sweepRequestSchema>;

export function makeAgentController(registry: ToolRegistry) {
  return {
    /** POST /api/agents/prioritize */
    async prioritize(_req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const result = await runPrioritizationAgent(registry);
        ok(res, result);
      } catch (err) {
        next(err);
      }
    },

    /** POST /api/agents/decompose */
    async decompose(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const body = req.body as DecomposeBody;
        const result = await runDecompositionAgent(body, registry);
        ok(res, result);
      } catch (err) {
        next(err);
      }
    },

    /** POST /api/agents/status-update */
    async statusUpdate(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const body = req.body as StatusUpdateBody;
        const result = await runStatusUpdateAgent(body, registry);
        ok(res, result);
      } catch (err) {
        next(err);
      }
    },

    /** POST /api/agents/sweep-stale */
    async sweepStale(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const body = req.body as SweepBody;
        const result = await runStaleSweeper(body, registry);
        ok(res, result);
      } catch (err) {
        next(err);
      }
    },
  };
}
