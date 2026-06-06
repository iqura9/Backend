import { Router } from "express";
import type { TaskService } from "./task.service";
import { makeTaskController } from "./task.controller";
import { createTaskSchema, updateTaskSchema, taskQuerySchema } from "./task.schema";
import { validateBody, validateQuery, validateParams, numericIdSchema } from "../../middleware/validate";

export function makeTaskRouter(service: TaskService): Router {
  const router = Router();
  const ctrl = makeTaskController(service);

  router.get("/", validateQuery(taskQuerySchema), ctrl.list.bind(ctrl));

  router.get("/:id", validateParams(numericIdSchema), ctrl.getOne.bind(ctrl));

  router.post("/", validateBody(createTaskSchema), ctrl.create.bind(ctrl));

  router.patch(
    "/:id",
    validateParams(numericIdSchema),
    validateBody(updateTaskSchema),
    ctrl.update.bind(ctrl),
  );

  router.delete("/:id", validateParams(numericIdSchema), ctrl.remove.bind(ctrl));

  return router;
}
