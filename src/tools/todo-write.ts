/**
 * TodoWrite tool.
 * Persists structured task todos to .claude/todos.json in cwd.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ToolImplementation, ToolResult, ToolContext } from "./registry.ts";

type TodoItem = {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
};

export const TodoWriteTool: ToolImplementation = {
  name: "TodoWrite",
  description: "Write/update task todo items for the current session.",
  inputSchema: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            content: { type: "string" },
            status: { type: "string", enum: ["pending", "in_progress", "completed"] },
            activeForm: { type: "string" },
          },
          required: ["content", "status"],
        },
      },
    },
    required: ["todos"],
  },

  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const { todos } = (input ?? {}) as { todos?: TodoItem[] };

    if (!Array.isArray(todos)) {
      return { content: "Error: todos must be an array", isError: true };
    }

    for (const todo of todos) {
      if (!todo?.content || !todo?.status) {
        return { content: "Error: each todo requires content and status", isError: true };
      }
    }

    const filePath = join(ctx.cwd, ".claude", "todos.json");

    try {
      await mkdir(dirname(filePath), { recursive: true });

      const payload = {
        updatedAt: new Date().toISOString(),
        todos,
      };

      await writeFile(filePath, JSON.stringify(payload, null, 2) + "\n", "utf-8");

      return {
        content: `Saved ${todos.length} todo item(s) to ${filePath}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Error writing todos: ${message}`, isError: true };
    }
  },
};
