/**
 * Read tool — file reading with line numbers.
 */

import type { ToolImplementation, ToolResult, ToolContext } from "./registry.ts";

const MAX_LINE_LENGTH = 2_000;
const DEFAULT_LINE_LIMIT = 2_000;

export const ReadTool: ToolImplementation = {
  name: "Read",
  description:
    "Reads a file from the filesystem. Returns content with line numbers (cat -n format). " +
    "Supports offset/limit for large files. Lines longer than 2000 chars are truncated.",
  inputSchema: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Absolute path to the file to read",
      },
      offset: {
        type: "number",
        description: "Line number to start reading from (1-based)",
      },
      limit: {
        type: "number",
        description: "Number of lines to read",
      },
    },
    required: ["file_path"],
  },

  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const { file_path, offset, limit } = input as {
      file_path: string;
      offset?: number;
      limit?: number;
    };

    if (!file_path) {
      return { content: "Error: file_path is required", isError: true };
    }

    const resolvedPath = resolvePath(file_path, ctx.cwd);

    try {
      const file = Bun.file(resolvedPath);
      const exists = await file.exists();

      if (!exists) {
        return { content: `Error: File not found: ${resolvedPath}`, isError: true };
      }

      const text = await file.text();
      const lines = text.split("\n");

      const startLine = Math.max(1, offset ?? 1);
      const lineLimit = limit ?? DEFAULT_LINE_LIMIT;
      const endLine = Math.min(lines.length, startLine + lineLimit - 1);

      const numberedLines: string[] = [];
      for (let i = startLine - 1; i < endLine; i++) {
        let line = lines[i];
        if (line.length > MAX_LINE_LENGTH) {
          line = line.slice(0, MAX_LINE_LENGTH) + "... (truncated)";
        }
        const lineNum = String(i + 1).padStart(6, " ");
        numberedLines.push(`${lineNum}\t${line}`);
      }

      return { content: numberedLines.join("\n") };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Error reading file: ${message}`, isError: true };
    }
  },
};

function resolvePath(filePath: string, cwd: string): string {
  if (filePath.startsWith("/")) return filePath;
  return `${cwd}/${filePath}`;
}
