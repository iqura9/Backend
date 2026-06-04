import { SchemaType } from "@google/generative-ai";
import type { RegisteredTool } from "../tool-registry";
import type { TaskService } from "../../../tasks/task.service";
import type { TaskStatus, TaskPriority } from "../../../tasks/task.model";

/**
 * Builds the set of task-related tools backed by the injected TaskService.
 * Each tool is a standalone object with a function declaration (for Gemini)
 * and a typed executor (called by the agent runner).
 */
export function buildTaskTools(service: TaskService): Record<string, RegisteredTool> {
  return {

    list_tasks: {
      declaration: {
        name: "list_tasks",
        description:
          "List all tasks, optionally filtered by status or priority. Returns id, title, description, status, priority, createdAt, updatedAt, and parentId.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            status: {
              type: SchemaType.STRING,
              description: "Filter by status: 'todo' | 'in-progress' | 'done'",
            },
            priority: {
              type: SchemaType.STRING,
              description: "Filter by priority: 'low' | 'medium' | 'high'",
            },
            parentId: {
              type: SchemaType.STRING,
              description: "Pass 'null' to get only top-level tasks, or a numeric ID to get subtasks of that parent",
            },
          },
          required: [],
        },
      },
      execute: async (args) => {
        const { status, priority, parentId } = args as {
          status?: TaskStatus;
          priority?: TaskPriority;
          parentId?: string;
        };
        const resolvedParentId =
          parentId === "null" ? null : parentId !== undefined ? Number(parentId) : undefined;
        return service.listTasks({ status, priority, parentId: resolvedParentId });
      },
    },

    get_task: {
      declaration: {
        name: "get_task",
        description: "Fetch a single task by its numeric ID, including all fields.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            id: { type: SchemaType.INTEGER, description: "Task ID" },
          },
          required: ["id"],
        },
      },
      execute: async (args) => {
        const { id } = args as { id: number };
        try {
          return service.getTask(id);
        } catch {
          return { error: `Task ${id} not found` };
        }
      },
    },

    create_task: {
      declaration: {
        name: "create_task",
        description: "Create a new task (or subtask when parentId is supplied).",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            title: { type: SchemaType.STRING, description: "Task title (required)" },
            description: { type: SchemaType.STRING, description: "Detailed description" },
            priority: {
              type: SchemaType.STRING,
              description: "Priority: 'low' | 'medium' | 'high'",
            },
            status: {
              type: SchemaType.STRING,
              description: "Initial status: 'todo' | 'in-progress' | 'done'",
            },
            parentId: {
              type: SchemaType.INTEGER,
              description: "Parent task ID — set to make this a subtask",
            },
          },
          required: ["title"],
        },
      },
      execute: async (args) => {
        const { title, description, priority, status, parentId } = args as {
          title: string;
          description?: string;
          priority?: TaskPriority;
          status?: TaskStatus;
          parentId?: number;
        };
        return service.createTask({ title, description, priority, status, parentId });
      },
    },

    update_task: {
      declaration: {
        name: "update_task",
        description: "Update fields on an existing task (partial update — only supplied fields change).",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            id: { type: SchemaType.INTEGER, description: "Task ID to update" },
            title: { type: SchemaType.STRING },
            description: { type: SchemaType.STRING },
            status: {
              type: SchemaType.STRING,
              description: "'todo' | 'in-progress' | 'done'",
            },
            priority: {
              type: SchemaType.STRING,
              description: "'low' | 'medium' | 'high'",
            },
          },
          required: ["id"],
        },
      },
      execute: async (args) => {
        const { id, ...patch } = args as {
          id: number;
          title?: string;
          description?: string;
          status?: TaskStatus;
          priority?: TaskPriority;
        };
        try {
          return service.updateTask(id, patch);
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    },

    create_subtasks: {
      declaration: {
        name: "create_subtasks",
        description:
          "Create multiple subtasks under a parent task in a single call. Each item requires a title; description and priority are optional.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            parentId: { type: SchemaType.INTEGER, description: "ID of the parent task" },
            items: {
              type: SchemaType.ARRAY,
              description: "List of subtasks to create",
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  title: { type: SchemaType.STRING },
                  description: { type: SchemaType.STRING },
                  priority: { type: SchemaType.STRING },
                },
                required: ["title"],
              },
            },
          },
          required: ["parentId", "items"],
        },
      },
      execute: async (args) => {
        const { parentId, items } = args as {
          parentId: number;
          items: Array<{ title: string; description?: string; priority?: TaskPriority }>;
        };
        try {
          return service.createSubtasks(parentId, items);
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    },

  };
}
