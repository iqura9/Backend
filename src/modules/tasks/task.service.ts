import type { TaskRepository } from "./task.repository";
import type { Task, CreateTaskInput, UpdateTaskInput, TaskQuery } from "./task.model";
import { NotFoundError, ConflictError } from "../../shared/errors";

export class TaskService {
  constructor(private readonly repo: TaskRepository) {}

  listTasks(query: TaskQuery): Task[] {
    return this.repo.findAll(query);
  }

  getTask(id: number): Task {
    const task = this.repo.findById(id);
    if (!task) throw new NotFoundError(`Task ${id} not found`);
    return task;
  }

  createTask(input: CreateTaskInput): Task {
    if (input.parentId !== undefined) {
      const parent = this.repo.findById(input.parentId);
      if (!parent) throw new NotFoundError(`Parent task ${input.parentId} not found`);
      // Enforce max one level of nesting: a subtask cannot be a parent
      if (parent.parentId !== null) {
        throw new ConflictError(
          `Task ${input.parentId} is itself a subtask — nesting beyond one level is not allowed`,
        );
      }
    }
    return this.repo.create(input);
  }

  updateTask(id: number, input: UpdateTaskInput): Task {
    const existing = this.repo.findById(id);
    if (!existing) throw new NotFoundError(`Task ${id} not found`);

    const updated = this.repo.update(id, input);
    if (!updated) throw new NotFoundError(`Task ${id} not found`);
    return updated;
  }

  deleteTask(id: number): void {
    if (!this.repo.delete(id)) throw new NotFoundError(`Task ${id} not found`);
  }

  /** Convenience: create multiple subtasks under a parent in one call. */
  createSubtasks(parentId: number, items: Omit<CreateTaskInput, "parentId">[]): Task[] {
    // Validate parent once
    const parent = this.repo.findById(parentId);
    if (!parent) throw new NotFoundError(`Parent task ${parentId} not found`);
    if (parent.parentId !== null) {
      throw new ConflictError(`Task ${parentId} is itself a subtask — cannot nest further`);
    }

    return items.map((item) => this.repo.create({ ...item, parentId }));
  }
}
