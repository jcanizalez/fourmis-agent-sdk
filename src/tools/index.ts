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
export { NotebookEditTool } from "./notebook-edit.ts";
export { WebFetchTool } from "./web-fetch.ts";
export { WebSearchTool } from "./web-search.ts";
export { AskUserQuestionTool } from "./ask-user-question.ts";
export { TodoWriteTool } from "./todo-write.ts";
export { ConfigTool } from "./config.ts";
export { ExitPlanModeTool } from "./exit-plan-mode.ts";

import { ToolRegistry } from "./registry.ts";
import type { ToolImplementation } from "./registry.ts";
import { BashTool } from "./bash.ts";
import { ReadTool } from "./read.ts";
import { WriteTool } from "./write.ts";
import { EditTool } from "./edit.ts";
import { GlobTool } from "./glob.ts";
import { GrepTool } from "./grep.ts";
import { NotebookEditTool } from "./notebook-edit.ts";
import { WebFetchTool } from "./web-fetch.ts";
import { WebSearchTool } from "./web-search.ts";
import { AskUserQuestionTool } from "./ask-user-question.ts";
import { TodoWriteTool } from "./todo-write.ts";
import { ConfigTool } from "./config.ts";
import { ExitPlanModeTool } from "./exit-plan-mode.ts";

const ALL_TOOLS: Record<string, ToolImplementation> = {
  Bash: BashTool,
  Read: ReadTool,
  Write: WriteTool,
  Edit: EditTool,
  Glob: GlobTool,
  Grep: GrepTool,
  NotebookEdit: NotebookEditTool,
  WebFetch: WebFetchTool,
  WebSearch: WebSearchTool,
  AskUserQuestion: AskUserQuestionTool,
  TodoWrite: TodoWriteTool,
  Config: ConfigTool,
  ExitPlanMode: ExitPlanModeTool,
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
