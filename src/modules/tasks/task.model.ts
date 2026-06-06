
export type TaskStatus = "todo" | "in-progress" | "done";
export type TaskPriority = "low" | "medium" | "high";

export interface Task {
  id: number;
  parentId: number | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  estimation: number | null; // hours
  estimationFromSubtasks: boolean; // when true, effective estimation = sum of subtasks
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

export interface TaskRow {
  id: number;
  parent_id: number | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  estimation: number | null;
  estimation_from_subtasks: number; // SQLite boolean: 0 | 1
  created_at: string;
  updated_at: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  estimation?: number;
  estimationFromSubtasks?: boolean;
  parentId?: number;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  estimation?: number | null;
  estimationFromSubtasks?: boolean;
}

export interface TaskQuery {
  status?: TaskStatus;
  priority?: TaskPriority;
  parentId?: number | null; // null = top-level only; undefined = all
  sortBy?: "priority" | "createdAt";
  order?: "asc" | "desc";
}

export function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    estimation: row.estimation ?? null,
    estimationFromSubtasks: row.estimation_from_subtasks === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
