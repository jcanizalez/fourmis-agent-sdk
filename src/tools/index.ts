/**
 * Tool system — re-exports and default registry builder.
 */

export { ToolRegistry } from "./registry.ts";
export type { ToolImplementation, ToolResult, ToolContext } from "./registry.ts";
export { PRESETS, resolveToolNames } from "./presets.ts";
export { BashTool } from "./bash.ts";
export { ReadTool } from "./read.ts";
export { WriteTool } from "./write.ts";
export { EditTool } from "./edit.ts";
export { GlobTool } from "./glob.ts";
export { GrepTool } from "./grep.ts";

import { ToolRegistry } from "./registry.ts";
import type { ToolImplementation } from "./registry.ts";
import { BashTool } from "./bash.ts";
import { ReadTool } from "./read.ts";
import { WriteTool } from "./write.ts";
import { EditTool } from "./edit.ts";
import { GlobTool } from "./glob.ts";
import { GrepTool } from "./grep.ts";

const ALL_TOOLS: Record<string, ToolImplementation> = {
  Bash: BashTool,
  Read: ReadTool,
  Write: WriteTool,
  Edit: EditTool,
  Glob: GlobTool,
  Grep: GrepTool,
};

/**
 * Build a ToolRegistry populated with the requested tools.
 */
export function buildToolRegistry(
  toolNames: string[],
  allowedTools?: string[],
  disallowedTools?: string[],
): ToolRegistry {
  const registry = new ToolRegistry();

  for (const name of toolNames) {
    if (disallowedTools?.includes(name)) continue;

    const tool = ALL_TOOLS[name];
    if (tool) {
      registry.register(tool);
    }
  }

  return registry;
}
