import type Database from "better-sqlite3";
import {
  type Task,
  type TaskRow,
  type CreateTaskInput,
  type UpdateTaskInput,
  type TaskQuery,
  rowToTask,
} from "./task.model";

// ─── Contract ─────────────────────────────────────────────────────────────────

export interface TaskRepository {
  findAll(query?: TaskQuery): Task[];
  findById(id: number): Task | undefined;
  create(input: CreateTaskInput): Task;
  update(id: number, input: UpdateTaskInput): Task | undefined;
  delete(id: number): boolean;
}

// ─── SQLite implementation ────────────────────────────────────────────────────

// status & priority are normalized into lookup tables; resolve the names via JOIN
// and alias them back to the column names TaskRow / rowToTask expect.
const SELECT_TASK = `
  SELECT
    t.id, t.parent_id, t.title, t.description,
    s.name AS status, p.name AS priority,
    t.estimation, t.estimation_from_subtasks, t.created_at, t.updated_at
  FROM tasks t
  JOIN statuses   s ON s.id = t.status_id
  JOIN priorities p ON p.id = t.priority_id
`;

export class SqliteTaskRepository implements TaskRepository {
  constructor(private readonly db: Database.Database) {}

  findAll(query: TaskQuery = {}): Task[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.status) {
      conditions.push("s.name = ?");
      params.push(query.status);
    }
    if (query.priority) {
      conditions.push("p.name = ?");
      params.push(query.priority);
    }
    if (query.parentId === null) {
      conditions.push("t.parent_id IS NULL");
    } else if (query.parentId !== undefined) {
      conditions.push("t.parent_id = ?");
      params.push(query.parentId);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const dir = query.order?.toUpperCase() === "DESC" ? "DESC" : "ASC";
    const orderBy =
      query.sortBy === "createdAt"
        ? `t.created_at ${dir}, t.id ${dir}` // id as tiebreaker when timestamps are identical
        : `p.sort_order ${dir}, t.created_at ASC`;

    const rows = this.db
      .prepare(`${SELECT_TASK} ${where} ORDER BY ${orderBy}`)
      .all(...params) as TaskRow[];

    return rows.map(rowToTask);
  }

  findById(id: number): Task | undefined {
    const row = this.db
      .prepare(`${SELECT_TASK} WHERE t.id = ?`)
      .get(id) as TaskRow | undefined;

    return row ? rowToTask(row) : undefined;
  }

  create(input: CreateTaskInput): Task {
    const { lastInsertRowid } = this.db
      .prepare(
        `INSERT INTO tasks (parent_id, title, description, status_id, priority_id, estimation, estimation_from_subtasks)
         VALUES (?, ?, ?,
           (SELECT id FROM statuses   WHERE name = ?),
           (SELECT id FROM priorities WHERE name = ?),
           ?, ?)`,
      )
      .run(
        input.parentId ?? null,
        input.title,
        input.description ?? "",
        input.status ?? "todo",
        input.priority ?? "medium",
        input.estimation ?? null,
        input.estimationFromSubtasks ? 1 : 0,
      );

    return this.findById(lastInsertRowid as number)!;
  }

  update(id: number, input: UpdateTaskInput): Task | undefined {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.title !== undefined) { sets.push("title = ?"); params.push(input.title); }
    if (input.description !== undefined) { sets.push("description = ?"); params.push(input.description); }
    if (input.status !== undefined) { sets.push("status_id = (SELECT id FROM statuses WHERE name = ?)"); params.push(input.status); }
    if (input.priority !== undefined) { sets.push("priority_id = (SELECT id FROM priorities WHERE name = ?)"); params.push(input.priority); }
    if ("estimation" in input) { sets.push("estimation = ?"); params.push(input.estimation ?? null); }
    if (input.estimationFromSubtasks !== undefined) { sets.push("estimation_from_subtasks = ?"); params.push(input.estimationFromSubtasks ? 1 : 0); }

    if (sets.length === 0) return this.findById(id);

    // updated_at is maintained by the tasks_updated_at trigger
    const { changes } = this.db
      .prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`)
      .run(...params, id);

    return changes === 0 ? undefined : this.findById(id);
  }

  delete(id: number): boolean {
    const { changes } = this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    return changes > 0;
  }
}
