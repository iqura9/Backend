import { Router } from "express";
import type { ToolRegistry } from "./core/tool-registry";
import { makeAgentController } from "./agent.controller";
import {
  decomposeRequestSchema,
  statusUpdateRequestSchema,
  sweepRequestSchema,
} from "./agent.schema";
import { validateBody } from "../../middleware/validate";
import { aiLimiter } from "../../middleware/rate-limit";

export function makeAgentRouter(registry: ToolRegistry): Router {
  const router = Router();
  const ctrl = makeAgentController(registry);

  // All AI routes share the stricter rate limiter
  router.use(aiLimiter);

  /**
   * POST /api/agents/prioritize
   * Returns a ranked "start your day" plan for the team.
   */
  router.post("/prioritize", ctrl.prioritize.bind(ctrl));

  /**
   * POST /api/agents/decompose
   * Breaks a task into actionable subtasks.
   * Body: { taskId? | title?, description?, persist?, clarification? }
   */
  router.post(
    "/decompose",
    validateBody(decomposeRequestSchema),
    ctrl.decompose.bind(ctrl),
  );

  /**
   * POST /api/agents/status-update
   * Generates a Slack-style async status update for a task.
   * Body: { taskId, notes?, tone? }
   */
  router.post(
    "/status-update",
    validateBody(statusUpdateRequestSchema),
    ctrl.statusUpdate.bind(ctrl),
  );

  /**
   * POST /api/agents/sweep-stale
   * Identifies and optionally triages neglected tasks.
   * Body: { thresholdDays?, apply? }
   */
  router.post(
    "/sweep-stale",
    validateBody(sweepRequestSchema),
    ctrl.sweepStale.bind(ctrl),
  );

  return router;
}
