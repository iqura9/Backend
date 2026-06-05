// ─── Value types ─────────────────────────────────────────────────────────────

export type TaskStatus = "todo" | "in-progress" | "done";
export type TaskPriority = "low" | "medium" | "high";

// ─── Domain entity ────────────────────────────────────────────────────────────

export interface Task {
  id: number;
  parentId: number | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  estimation: number | null; // hours
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

// ─── Raw SQLite row (snake_case columns) ─────────────────────────────────────

export interface TaskRow {
  id: number;
  parent_id: number | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  estimation: number | null;
  created_at: string;
  updated_at: string;
}

// ─── Input types (validated before reaching the repository) ──────────────────

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  estimation?: number;
  parentId?: number;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  estimation?: number | null;
}

export interface TaskQuery {
  status?: TaskStatus;
  priority?: TaskPriority;
  parentId?: number | null; // null = top-level only; undefined = all
  sortBy?: "priority" | "createdAt";
  order?: "asc" | "desc";
}

// ─── Helper ───────────────────────────────────────────────────────────────────

export function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    estimation: row.estimation ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
