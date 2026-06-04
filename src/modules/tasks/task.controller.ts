import type { Request, Response, NextFunction } from "express";
import type { TaskService } from "./task.service";
import type { TaskQuery } from "./task.model";
import type { z } from "zod";
import type { createTaskSchema, updateTaskSchema, taskQuerySchema } from "./task.schema";
import { ok, created } from "../../shared/http";

type CreateBody = z.infer<typeof createTaskSchema>;
type UpdateBody = z.infer<typeof updateTaskSchema>;
type ListQuery = z.infer<typeof taskQuerySchema>;

/** Factory so the controller is injected with the service instance from the composition root. */
export function makeTaskController(service: TaskService) {
  return {
    /** GET /api/tasks */
    list(req: Request, res: Response, next: NextFunction): void {
      try {
        const query = (req as Request & { validatedQuery: ListQuery }).validatedQuery ?? {};
        const tasks = service.listTasks(query as TaskQuery);
        ok(res, tasks, { count: tasks.length });
      } catch (err) {
        next(err);
      }
    },

    /** GET /api/tasks/:id */
    getOne(req: Request, res: Response, next: NextFunction): void {
      try {
        const task = service.getTask(Number(req.params.id));
        ok(res, task);
      } catch (err) {
        next(err);
      }
    },

    /** POST /api/tasks */
    create(req: Request, res: Response, next: NextFunction): void {
      try {
        const task = service.createTask(req.body as CreateBody);
        created(res, task);
      } catch (err) {
        next(err);
      }
    },

    /** PATCH /api/tasks/:id */
    update(req: Request, res: Response, next: NextFunction): void {
      try {
        const task = service.updateTask(Number(req.params.id), req.body as UpdateBody);
        ok(res, task);
      } catch (err) {
        next(err);
      }
    },

    /** DELETE /api/tasks/:id */
    remove(req: Request, res: Response, next: NextFunction): void {
      try {
        service.deleteTask(Number(req.params.id));
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  };
}
