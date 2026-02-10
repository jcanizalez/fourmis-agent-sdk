/**
 * Glob tool — file pattern matching.
 */

import { Glob } from "bun";
import type { ToolImplementation, ToolResult, ToolContext } from "./registry.ts";

export const GlobTool: ToolImplementation = {
  name: "Glob",
  description:
    "Fast file pattern matching. Supports glob patterns like '**/*.ts' or 'src/**/*.tsx'. " +
    "Returns matching file paths sorted by modification time.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Glob pattern to match files against",
      },
      path: {
        type: "string",
        description: "Directory to search in (defaults to cwd)",
      },
    },
    required: ["pattern"],
  },

  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const { pattern, path } = input as {
      pattern: string;
      path?: string;
    };

    if (!pattern) {
      return { content: "Error: pattern is required", isError: true };
    }

    const searchDir = path
      ? (path.startsWith("/") ? path : `${ctx.cwd}/${path}`)
      : ctx.cwd;

    try {
      const glob = new Glob(pattern);
      const matches: { path: string; mtime: number }[] = [];

      for await (const filePath of glob.scan({ cwd: searchDir, dot: false })) {
        try {
          const file = Bun.file(`${searchDir}/${filePath}`);
          const stat = await file.stat();
          matches.push({ path: filePath, mtime: stat?.mtime?.getTime() ?? 0 });
        } catch {
          matches.push({ path: filePath, mtime: 0 });
        }
      }

      // Sort by mtime descending (most recent first)
      matches.sort((a, b) => b.mtime - a.mtime);

      if (matches.length === 0) {
        return { content: "No files matched the pattern." };
      }

      const result = matches.map((m) => m.path).join("\n");
      return {
        content: result,
        metadata: { count: matches.length },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Error: ${message}`, isError: true };
    }
  },
};
