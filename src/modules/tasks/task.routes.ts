import { Router } from "express";
import type { TaskService } from "./task.service";
import { makeTaskController } from "./task.controller";
import { createTaskSchema, updateTaskSchema, taskQuerySchema } from "./task.schema";
import { validateBody, validateQuery, validateParams, numericIdSchema } from "../../middleware/validate";

export function makeTaskRouter(service: TaskService): Router {
  const router = Router();
  const ctrl = makeTaskController(service);

  // GET /api/tasks
  router.get("/", validateQuery(taskQuerySchema), ctrl.list.bind(ctrl));

  // GET /api/tasks/:id
  router.get("/:id", validateParams(numericIdSchema), ctrl.getOne.bind(ctrl));

  // POST /api/tasks
  router.post("/", validateBody(createTaskSchema), ctrl.create.bind(ctrl));

  // PATCH /api/tasks/:id
  router.patch(
    "/:id",
    validateParams(numericIdSchema),
    validateBody(updateTaskSchema),
    ctrl.update.bind(ctrl),
  );

  // DELETE /api/tasks/:id
  router.delete("/:id", validateParams(numericIdSchema), ctrl.remove.bind(ctrl));

  return router;
}
