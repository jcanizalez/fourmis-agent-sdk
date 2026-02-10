/**
 * Named tool presets for common use cases.
 */

export const PRESETS: Record<string, string[]> = {
  coding: ["Bash", "Read", "Write", "Edit", "Glob", "Grep"],
  readonly: ["Read", "Glob", "Grep"],
  minimal: ["Read", "Write", "Edit", "Glob", "Grep"],
};

export function resolveToolNames(tools: string | string[] | undefined): string[] {
  if (!tools) return PRESETS.coding;
  if (typeof tools === "string") {
    return PRESETS[tools] ?? [tools];
  }
  return tools;
}
