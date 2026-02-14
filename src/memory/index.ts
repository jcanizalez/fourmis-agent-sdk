/**
 * Memory module — provider-agnostic memory tool.
 *
 * For Anthropic: Returns a native memory tool config that the provider
 * handles specially (type: "memory_20250818" + beta header).
 *
 * For OpenAI/Gemini: Returns a regular ToolImplementation that the
 * agent can call just like any other tool.
 */

export { createMemoryHandler } from "./memory-handler.ts";
export type { MemoryCommand } from "./memory-handler.ts";

import { createMemoryHandler } from "./memory-handler.ts";
import type { MemoryCommand } from "./memory-handler.ts";
import type { ToolImplementation } from "../tools/registry.ts";

// ─── Memory Configuration ──────────────────────────────────────────────────

export type MemoryConfig = {
  /** Absolute path to the memory directory (e.g. /workspace/memories/) */
  path: string;
};

// ─── Native Memory Tool (Anthropic) ───────────────────────────────────────

/**
 * For Anthropic provider: returns the native memory tool definition
 * to include in the API request, plus handler functions for each command.
 *
 * The Anthropic provider needs to:
 * 1. Add `{type: "memory_20250818", name: "memory"}` to the tools array
 * 2. Add `context-management-2025-06-27` beta header
 * 3. Route "memory" tool calls to the handler
 */
export type NativeMemoryTool = {
  /** The tool definition for the Anthropic API (type: "memory_20250818") */
  definition: { type: "memory_20250818"; name: "memory" };
  /** Execute a memory command */
  execute: (cmd: MemoryCommand) => Promise<string>;
};

export function createNativeMemoryTool(config: MemoryConfig): NativeMemoryTool {
  const handler = createMemoryHandler(config.path);
  return {
    definition: { type: "memory_20250818", name: "memory" },
    execute: (cmd) => handler.execute(cmd),
  };
}

// ─── Regular Memory Tool (OpenAI/Gemini) ──────────────────────────────────

/**
 * For non-Anthropic providers: wraps memory as a standard ToolImplementation
 * so any LLM can call it as a regular function tool.
 */
export function createMemoryTool(config: MemoryConfig): ToolImplementation {
  const handler = createMemoryHandler(config.path);

  return {
    name: "memory",
    description:
      "Manage persistent memory files. Supports 6 commands:\n" +
      "- view: Show directory listing or file contents (path, optional view_range)\n" +
      "- create: Create a new file (path, file_text)\n" +
      "- str_replace: Replace text in a file (path, old_str, new_str)\n" +
      "- insert: Insert text at a line number (path, insert_line, insert_text)\n" +
      "- delete: Delete a file or directory (path)\n" +
      "- rename: Rename/move a file or directory (old_path, new_path)\n\n" +
      "All paths should start with /memories/. Example: /memories/notes.txt\n\n" +
      "IMPORTANT: Always view your memory directory before starting any task.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          enum: ["view", "create", "str_replace", "insert", "delete", "rename"],
          description: "The memory operation to perform",
        },
        path: {
          type: "string",
          description: "Path to the file or directory (starts with /memories/)",
        },
        file_text: {
          type: "string",
          description: "Content for the 'create' command",
        },
        old_str: {
          type: "string",
          description: "Text to find for 'str_replace' command",
        },
        new_str: {
          type: "string",
          description: "Replacement text for 'str_replace' command",
        },
        insert_line: {
          type: "number",
          description: "Line number for 'insert' command",
        },
        insert_text: {
          type: "string",
          description: "Text to insert for 'insert' command",
        },
        old_path: {
          type: "string",
          description: "Source path for 'rename' command",
        },
        new_path: {
          type: "string",
          description: "Destination path for 'rename' command",
        },
        view_range: {
          type: "array",
          items: { type: "number" },
          description: "Optional [start, end] line range for 'view' command",
        },
      },
      required: ["command"],
    },
    async execute(input: unknown): Promise<{ content: string; isError?: boolean }> {
      try {
        const cmd = input as MemoryCommand;
        const result = await handler.execute(cmd);
        // Detect error results
        const isError = result.startsWith("Error:");
        return { content: result, isError };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: `Error: ${message}`, isError: true };
      }
    },
  };
}
