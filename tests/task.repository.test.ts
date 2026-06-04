import { describe, it, expect, beforeEach, afterAll } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { SqliteTaskRepository } from "../src/modules/tasks/task.repository";
import type { TaskRepository } from "../src/modules/tasks/task.repository";

// ─── Setup: in-memory DB with real migrations ─────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  // Apply migration directly
  const sql = fs.readFileSync(
    path.resolve(__dirname, "../src/db/migrations/001_init.sql"),
    "utf8",
  );
  db.exec(sql);
  return db;
}

let db: Database.Database;
let repo: TaskRepository;

beforeEach(() => {
  db = createTestDb();
  repo = new SqliteTaskRepository(db);
});

afterAll(() => {
  db?.close();
});

// ─── CRUD ────────────────────────────────────────────────────────────────────

describe("create & findById", () => {
  it("creates a task and retrieves it by id", () => {
    const task = repo.create({ title: "Write tests", priority: "high" });

    expect(task.id).toBeGreaterThan(0);
    expect(task.title).toBe("Write tests");
    expect(task.priority).toBe("high");
    expect(task.status).toBe("todo");
    expect(task.parentId).toBeNull();
    expect(task.createdAt).toBeTruthy();
    expect(task.updatedAt).toBeTruthy();

    const found = repo.findById(task.id);
    expect(found).toEqual(task);
  });

  it("returns undefined for a non-existent id", () => {
    expect(repo.findById(99999)).toBeUndefined();
  });
});

describe("update", () => {
  it("partially updates a task", () => {
    const task = repo.create({ title: "Old title", status: "todo" });
    const updated = repo.update(task.id, { title: "New title", status: "in-progress" });

    expect(updated?.title).toBe("New title");
    expect(updated?.status).toBe("in-progress");
    expect(updated?.priority).toBe("medium"); // unchanged
  });

  it("returns undefined when updating a non-existent task", () => {
    expect(repo.update(99999, { title: "x" })).toBeUndefined();
  });

  it("returns the task unchanged when no update fields are provided", () => {
    const task = repo.create({ title: "Stable task" });
    const result = repo.update(task.id, {});
    expect(result).toEqual(repo.findById(task.id));
  });
});

describe("delete", () => {
  it("deletes an existing task and returns true", () => {
    const task = repo.create({ title: "To delete" });
    expect(repo.delete(task.id)).toBe(true);
    expect(repo.findById(task.id)).toBeUndefined();
  });

  it("returns false when deleting a non-existent task", () => {
    expect(repo.delete(99999)).toBe(false);
  });
});

// ─── Filtering ────────────────────────────────────────────────────────────────

describe("findAll – filtering", () => {
  beforeEach(() => {
    repo.create({ title: "Todo low", status: "todo", priority: "low" });
    repo.create({ title: "In-progress high", status: "in-progress", priority: "high" });
    repo.create({ title: "Done medium", status: "done", priority: "medium" });
  });

  it("returns all tasks with no filter", () => {
    expect(repo.findAll()).toHaveLength(3);
  });

  it("filters by status", () => {
    const result = repo.findAll({ status: "todo" });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Todo low");
  });

  it("filters by priority", () => {
    const result = repo.findAll({ priority: "high" });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("In-progress high");
  });

  it("combines status and priority filters", () => {
    const result = repo.findAll({ status: "todo", priority: "low" });
    expect(result).toHaveLength(1);
  });
});

// ─── Sorting ──────────────────────────────────────────────────────────────────

describe("findAll – sorting", () => {
  it("sorts by priority ascending (high → medium → low)", () => {
    repo.create({ title: "Low", priority: "low" });
    repo.create({ title: "High", priority: "high" });
    repo.create({ title: "Medium", priority: "medium" });

    const result = repo.findAll({ sortBy: "priority", order: "asc" });
    expect(result.map((t) => t.priority)).toEqual(["high", "medium", "low"]);
  });

  it("sorts by createdAt descending (newest first)", () => {
    repo.create({ title: "First" });
    // Two inserts may share the same ms timestamp; rely on id tiebreaker (DESC) for determinism
    repo.create({ title: "Second" });

    const result = repo.findAll({ sortBy: "createdAt", order: "desc" });
    // "Second" was created after "First" so it should come first in DESC
    const titles = result.map((t) => t.title);
    expect(titles.indexOf("Second")).toBeLessThan(titles.indexOf("First"));
  });
});

// ─── Subtasks (parentId) ──────────────────────────────────────────────────────

describe("subtasks", () => {
  it("creates a subtask with a valid parentId", () => {
    const parent = repo.create({ title: "Parent" });
    const child = repo.create({ title: "Child", parentId: parent.id });

    expect(child.parentId).toBe(parent.id);
  });

  it("filters top-level tasks with parentId=null", () => {
    const parent = repo.create({ title: "Parent" });
    repo.create({ title: "Child", parentId: parent.id });

    const roots = repo.findAll({ parentId: null });
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe(parent.id);
  });

  it("filters subtasks of a specific parent", () => {
    const parent = repo.create({ title: "Parent" });
    repo.create({ title: "Child A", parentId: parent.id });
    repo.create({ title: "Child B", parentId: parent.id });
    repo.create({ title: "Other root" });

    const children = repo.findAll({ parentId: parent.id });
    expect(children).toHaveLength(2);
    expect(children.every((c) => c.parentId === parent.id)).toBe(true);
  });

  it("cascade-deletes subtasks when the parent is deleted", () => {
    const parent = repo.create({ title: "Parent" });
    const child = repo.create({ title: "Child", parentId: parent.id });

    repo.delete(parent.id);

    expect(repo.findById(child.id)).toBeUndefined();
  });
});
