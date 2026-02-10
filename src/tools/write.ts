/**
 * Write tool — file creation/writing.
 */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ToolImplementation, ToolResult, ToolContext } from "./registry.ts";

export const WriteTool: ToolImplementation = {
  name: "Write",
  description:
    "Writes content to a file. Creates parent directories if needed. " +
    "Overwrites existing files.",
  inputSchema: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Absolute path to the file to write",
      },
      content: {
        type: "string",
        description: "The content to write to the file",
      },
    },
    required: ["file_path", "content"],
  },

  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const { file_path, content } = input as {
      file_path: string;
      content: string;
    };

    if (!file_path) {
      return { content: "Error: file_path is required", isError: true };
    }
    if (content === undefined || content === null) {
      return { content: "Error: content is required", isError: true };
    }

    const resolvedPath = file_path.startsWith("/") ? file_path : `${ctx.cwd}/${file_path}`;

    try {
      // Ensure parent directory exists
      const dir = dirname(resolvedPath);
      await mkdir(dir, { recursive: true });

      await Bun.write(resolvedPath, content);

      const lines = content.split("\n").length;
      return {
        content: `Successfully wrote ${lines} lines to ${resolvedPath}`,
        metadata: { path: resolvedPath, lines },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Error writing file: ${message}`, isError: true };
    }
  },
};
