import { createDatabase } from "./db/connection";
import { buildApp } from "./app";
import { env } from "./config/env";
import { logger } from "./shared/logger";

const db = createDatabase();
const app = buildApp(db);

const server = app.listen(env.PORT, () => {
  logger.info(`DevLog API  → http://localhost:${env.PORT}`);
  logger.info(`Swagger UI  → http://localhost:${env.PORT}/docs`);
  logger.info({ env: env.NODE_ENV, aiEnabled: !!env.GEMINI_API_KEY }, "Server ready");
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(signal: string): void {
  logger.info({ signal }, "Shutting down gracefully…");
  server.close(() => {
    db.close();
    logger.info("HTTP server and DB closed");
    process.exit(0);
  });

  // Force-exit if graceful shutdown takes too long
  setTimeout(() => {
    logger.error("Graceful shutdown timed out — forcing exit");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
