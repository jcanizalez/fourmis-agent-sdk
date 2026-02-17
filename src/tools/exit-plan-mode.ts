/**
 * ExitPlanMode tool.
 * Signals the runtime to leave plan mode and return to default permissions.
 */

import type { ToolImplementation, ToolResult } from "./registry.ts";

export const ExitPlanModeTool: ToolImplementation = {
  name: "ExitPlanMode",
  description: "Exit plan mode and resume normal execution permissions.",
  inputSchema: {
    type: "object",
    properties: {},
  },

  async execute(): Promise<ToolResult> {
    return {
      content: "Exiting plan mode.",
      metadata: {
        setPermissionMode: "default",
      },
    };
  },
};
