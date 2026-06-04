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

// Priority ORDER BY helper: high → 1, medium → 2, low → 3
const PRIORITY_RANK = `CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`;

const SELECT_COLS = `
  id, parent_id, title, description, status, priority, created_at, updated_at
`;

export class SqliteTaskRepository implements TaskRepository {
  constructor(private readonly db: Database.Database) {}

  findAll(query: TaskQuery = {}): Task[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.status) {
      conditions.push("status = ?");
      params.push(query.status);
    }
    if (query.priority) {
      conditions.push("priority = ?");
      params.push(query.priority);
    }
    if (query.parentId === null) {
      conditions.push("parent_id IS NULL");
    } else if (query.parentId !== undefined) {
      conditions.push("parent_id = ?");
      params.push(query.parentId);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const dir = query.order?.toUpperCase() === "DESC" ? "DESC" : "ASC";
    const orderBy =
      query.sortBy === "createdAt"
        ? `created_at ${dir}, id ${dir}` // id as tiebreaker when timestamps are identical
        : `${PRIORITY_RANK} ${dir}, created_at ASC`;

    const rows = this.db
      .prepare(`SELECT ${SELECT_COLS} FROM tasks ${where} ORDER BY ${orderBy}`)
      .all(...params) as TaskRow[];

    return rows.map(rowToTask);
  }

  findById(id: number): Task | undefined {
    const row = this.db
      .prepare(`SELECT ${SELECT_COLS} FROM tasks WHERE id = ?`)
      .get(id) as TaskRow | undefined;

    return row ? rowToTask(row) : undefined;
  }

  create(input: CreateTaskInput): Task {
    const { lastInsertRowid } = this.db
      .prepare(
        `INSERT INTO tasks (parent_id, title, description, status, priority)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.parentId ?? null,
        input.title,
        input.description ?? "",
        input.status ?? "todo",
        input.priority ?? "medium",
      );

    return this.findById(lastInsertRowid as number)!;
  }

  update(id: number, input: UpdateTaskInput): Task | undefined {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.title !== undefined) { sets.push("title = ?"); params.push(input.title); }
    if (input.description !== undefined) { sets.push("description = ?"); params.push(input.description); }
    if (input.status !== undefined) { sets.push("status = ?"); params.push(input.status); }
    if (input.priority !== undefined) { sets.push("priority = ?"); params.push(input.priority); }

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
