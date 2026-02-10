/**
 * Bash tool — shell command execution.
 */

import type { ToolImplementation, ToolResult, ToolContext } from "./registry.ts";

const DEFAULT_TIMEOUT = 120_000;
const MAX_TIMEOUT = 600_000;
const MAX_OUTPUT_LENGTH = 30_000;

export const BashTool: ToolImplementation = {
  name: "Bash",
  description:
    "Executes a bash command. Use for system operations, git commands, running scripts, and other terminal tasks. " +
    "Working directory persists between calls. Commands timeout after 120s by default (max 600s).",
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The bash command to execute",
      },
      description: {
        type: "string",
        description: "Brief description of what this command does",
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (max 600000)",
      },
    },
    required: ["command"],
  },

  async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
    const { command, timeout: timeoutMs, description } = input as {
      command: string;
      timeout?: number;
      description?: string;
    };

    if (!command || typeof command !== "string") {
      return { content: "Error: command is required", isError: true };
    }

    const timeout = Math.min(timeoutMs ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);

    try {
      const proc = Bun.spawn(["bash", "-c", command], {
        cwd: ctx.cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, ...ctx.env },
      });

      // Set up timeout
      const timeoutId = setTimeout(() => {
        proc.kill();
      }, timeout);

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      const exitCode = await proc.exited;
      clearTimeout(timeoutId);

      let output = "";
      if (stdout) output += stdout;
      if (stderr) output += (output ? "\n" : "") + stderr;

      // Truncate if needed
      if (output.length > MAX_OUTPUT_LENGTH) {
        output = output.slice(0, MAX_OUTPUT_LENGTH) + "\n... (output truncated)";
      }

      if (!output) {
        output = exitCode === 0
          ? "(no output)"
          : `Command failed with exit code ${exitCode}`;
      }

      return {
        content: output,
        isError: exitCode !== 0 ? true : undefined,
        metadata: { exitCode },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Error executing command: ${message}`, isError: true };
    }
  },
};
