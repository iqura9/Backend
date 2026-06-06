-- Normalize status & priority enums into dedicated lookup tables.
-- The tasks table now references them by FK id; the REST API contract stays
-- string-based (the repository maps name <-> id).

-- ─── Lookup tables (seeded first so AUTOINCREMENT ids are deterministic) ──────

CREATE TABLE IF NOT EXISTS statuses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);
INSERT INTO statuses (name, sort_order) VALUES
  ('todo', 1),
  ('in-progress', 2),
  ('done', 3);

CREATE TABLE IF NOT EXISTS priorities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);
-- high first preserves the previous default priority ordering
INSERT INTO priorities (name, sort_order) VALUES
  ('high', 1),
  ('medium', 2),
  ('low', 3);

-- ─── Rebuild tasks with FK columns (SQLite can't drop the old CHECK columns) ──

CREATE TABLE tasks_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id   INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  status_id   INTEGER NOT NULL DEFAULT 1 REFERENCES statuses(id),   -- 1 = 'todo'
  priority_id INTEGER NOT NULL DEFAULT 2 REFERENCES priorities(id), -- 2 = 'medium'
  estimation  REAL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO tasks_new (id, parent_id, title, description, status_id, priority_id, estimation, created_at, updated_at)
SELECT t.id, t.parent_id, t.title, t.description, s.id, p.id, t.estimation, t.created_at, t.updated_at
FROM tasks t
JOIN statuses   s ON s.name = t.status
JOIN priorities p ON p.name = t.priority;

DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

-- ─── Recreate indexes + updated_at trigger (dropped with the old table) ───────

CREATE INDEX IF NOT EXISTS idx_tasks_parent_id   ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status_id   ON tasks(status_id);
CREATE INDEX IF NOT EXISTS idx_tasks_priority_id ON tasks(priority_id);

CREATE TRIGGER IF NOT EXISTS tasks_updated_at
AFTER UPDATE ON tasks
FOR EACH ROW
BEGIN
  UPDATE tasks
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = OLD.id;
END;
