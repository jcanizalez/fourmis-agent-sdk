/**
 * Grep tool — regex content search.
 * Uses ripgrep (rg) if available, falls back to JS regex.
 */

import type { ToolImplementation, ToolResult, ToolContext } from "./registry.ts";

type OutputMode = "content" | "files_with_matches" | "count";

export const GrepTool: ToolImplementation = {
  name: "Grep",
  description:
    "Search file contents using regex patterns. Supports multiple output modes: " +
    "'content' (matching lines), 'files_with_matches' (file paths only, default), 'count' (match counts). " +
    "Supports context lines, case-insensitive search, glob filtering, and head_limit.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Regex pattern to search for",
      },
      path: {
        type: "string",
        description: "File or directory to search in (defaults to cwd)",
      },
      glob: {
        type: "string",
        description: "Glob pattern to filter files (e.g., '*.ts')",
      },
      output_mode: {
        type: "string",
        enum: ["content", "files_with_matches", "count"],
        description: "Output mode (default: files_with_matches)",
      },
      "-i": {
        type: "boolean",
        description: "Case insensitive search",
      },
      "-n": {
        type: "boolean",
        description: "Show line numbers (for content mode)",
      },
      "-A": {
        type: "number",
        description: "Lines to show after each match",
      },
      "-B": {
        type: "number",
        description: "Lines to show before each match",
      },
      "-C": {
        type: "number",
        description: "Context lines before and after each match",
      },
      head_limit: {
        type: "number",
        description: "Limit output to first N entries",
      },
    },
    required: ["pattern"],
  },

  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const opts = input as {
      pattern: string;
      path?: string;
      glob?: string;
      output_mode?: OutputMode;
      "-i"?: boolean;
      "-n"?: boolean;
      "-A"?: number;
      "-B"?: number;
      "-C"?: number;
      head_limit?: number;
    };

    if (!opts.pattern) {
      return { content: "Error: pattern is required", isError: true };
    }

    const searchPath = opts.path
      ? (opts.path.startsWith("/") ? opts.path : `${ctx.cwd}/${opts.path}`)
      : ctx.cwd;

    const mode = opts.output_mode ?? "files_with_matches";

    // Try ripgrep first
    try {
      return await runRipgrep(opts, searchPath, mode, ctx);
    } catch {
      // rg not available, fall back to JS
      return await runJsGrep(opts, searchPath, mode, ctx);
    }
  },
};

async function runRipgrep(
  opts: any,
  searchPath: string,
  mode: OutputMode,
  ctx: ToolContext,
): Promise<ToolResult> {
  const args = ["rg"];

  // Output mode
  if (mode === "files_with_matches") {
    args.push("-l");
  } else if (mode === "count") {
    args.push("-c");
  }

  // Options
  if (opts["-i"]) args.push("-i");
  if (opts["-n"] !== false && mode === "content") args.push("-n");
  if (opts["-A"]) args.push("-A", String(opts["-A"]));
  if (opts["-B"]) args.push("-B", String(opts["-B"]));
  if (opts["-C"]) args.push("-C", String(opts["-C"]));
  if (opts.glob) args.push("--glob", opts.glob);

  args.push("--", opts.pattern, searchPath);

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...ctx.env },
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  // rg returns 1 for no matches, 2 for errors
  if (exitCode === 2) {
    throw new Error(stderr || "ripgrep error");
  }

  let output = stdout.trim();

  // Apply head_limit
  if (opts.head_limit && output) {
    const lines = output.split("\n");
    output = lines.slice(0, opts.head_limit).join("\n");
  }

  return { content: output || "No matches found." };
}

async function runJsGrep(
  opts: any,
  searchPath: string,
  mode: OutputMode,
  ctx: ToolContext,
): Promise<ToolResult> {
  const flags = opts["-i"] ? "gi" : "g";
  let regex: RegExp;
  try {
    regex = new RegExp(opts.pattern, flags);
  } catch (err) {
    return { content: `Invalid regex: ${opts.pattern}`, isError: true };
  }

  // Get files to search
  const files = await collectFiles(searchPath, opts.glob);
  const results: string[] = [];
  let totalCount = 0;

  for (const filePath of files) {
    try {
      const content = await Bun.file(filePath).text();
      const lines = content.split("\n");
      const matchedLines: { num: number; line: string }[] = [];

      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matchedLines.push({ num: i + 1, line: lines[i] });
          regex.lastIndex = 0; // Reset for global regex
        }
      }

      if (matchedLines.length === 0) continue;
      totalCount += matchedLines.length;

      const relativePath = filePath.startsWith(ctx.cwd)
        ? filePath.slice(ctx.cwd.length + 1)
        : filePath;

      if (mode === "files_with_matches") {
        results.push(relativePath);
      } else if (mode === "count") {
        results.push(`${relativePath}:${matchedLines.length}`);
      } else {
        for (const { num, line } of matchedLines) {
          results.push(`${relativePath}:${num}:${line}`);
        }
      }
    } catch {
      // Skip unreadable files
    }

    if (opts.head_limit && results.length >= opts.head_limit) {
      break;
    }
  }

  let output = results.join("\n");
  if (opts.head_limit) {
    const entries = output.split("\n").slice(0, opts.head_limit);
    output = entries.join("\n");
  }

  return { content: output || "No matches found." };
}

async function collectFiles(dir: string, globPattern?: string): Promise<string[]> {
  const { Glob } = await import("bun");
  const pattern = globPattern ?? "**/*";
  const glob = new Glob(pattern);
  const files: string[] = [];

  for await (const path of glob.scan({ cwd: dir, dot: false, onlyFiles: true })) {
    files.push(`${dir}/${path}`);
  }

  return files;
}
