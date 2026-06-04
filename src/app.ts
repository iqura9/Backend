import express from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import swaggerUi from "swagger-ui-express";
import type Database from "better-sqlite3";

import { logger } from "./shared/logger";
import { errorHandler } from "./middleware/error-handler";
import { apiLimiter } from "./middleware/rate-limit";

import { SqliteTaskRepository } from "./modules/tasks/task.repository";
import { TaskService } from "./modules/tasks/task.service";
import { makeTaskRouter } from "./modules/tasks/task.routes";

import { ToolRegistry } from "./modules/agents/core/tool-registry";
import { buildTaskTools } from "./modules/agents/core/tools/task-tools";
import { makeAgentRouter } from "./modules/agents/agent.routes";

import { generateOpenApiSpec } from "./docs/openapi";

export function buildApp(db: Database.Database): express.Application {
  const app = express();

  // ─── Security & parsing ────────────────────────────────────────────────────
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  // ─── Logging ───────────────────────────────────────────────────────────────
  app.use(
    pinoHttp({
      logger,
      customLogLevel: (_req, res) => (res.statusCode >= 500 ? "error" : "info"),
    }),
  );

  // ─── Rate limiting ─────────────────────────────────────────────────────────
  app.use("/api", apiLimiter);

  // ─── Dependency wiring ─────────────────────────────────────────────────────
  const taskRepo = new SqliteTaskRepository(db);
  const taskService = new TaskService(taskRepo);

  const toolRegistry = new ToolRegistry();
  const taskTools = buildTaskTools(taskService);
  Object.values(taskTools).forEach((tool) => toolRegistry.register(tool));

  // ─── API routes ────────────────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.use("/api/tasks", makeTaskRouter(taskService));
  app.use("/api/agents", makeAgentRouter(toolRegistry));

  // ─── Swagger UI ────────────────────────────────────────────────────────────
  const spec = generateOpenApiSpec();
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(spec));
  app.get("/docs.json", (_req, res) => res.json(spec));

  // ─── 404 catch-all ─────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });

  // ─── Global error handler ──────────────────────────────────────────────────
  app.use(errorHandler);

  return app;
}
