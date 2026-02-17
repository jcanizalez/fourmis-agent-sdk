/**
 * Named tool presets for common use cases.
 */

import type { ToolsOption } from "../types.ts";

export const PRESETS: Record<string, string[]> = {
  coding: ["Bash", "Read", "Write", "Edit", "Glob", "Grep"],
  claude_code: [
    "Bash",
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "NotebookEdit",
    "WebFetch",
    "WebSearch",
    "TodoWrite",
    "Config",
    "AskUserQuestion",
    "ExitPlanMode",
  ],
  readonly: ["Read", "Glob", "Grep"],
  minimal: ["Read", "Write", "Edit", "Glob", "Grep"],
};

export function resolveToolNames(tools: ToolsOption | undefined): string[] {
  if (!tools) return PRESETS.claude_code;
  if (Array.isArray(tools)) {
    return tools;
  }
  if (tools.type === "preset") {
    return PRESETS[tools.preset] ?? PRESETS.claude_code;
  }
  throw new Error("Invalid tools option. Expected string[] or { type: 'preset', preset: 'claude_code' }.");
}
