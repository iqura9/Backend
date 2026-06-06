-- Per-task flag: when on, the task's effective estimation is the sum of its
-- subtasks' estimations rather than its own manual estimation value.
ALTER TABLE tasks ADD COLUMN estimation_from_subtasks INTEGER NOT NULL DEFAULT 0;
