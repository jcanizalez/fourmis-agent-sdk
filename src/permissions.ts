/**
 * Permission manager — controls which tools the agent can use.
 */

import type { PermissionMode, PermissionResult, CanUseTool } from "./types.ts";

// Tools that are always safe (read-only, no side effects)
const SAFE_TOOLS = new Set(["Read", "Glob", "Grep"]);

// Tools that modify files but are reversible
const EDIT_TOOLS = new Set(["Write", "Edit"]);

export class PermissionManager {
  private mode: PermissionMode;
  private canUseTool?: CanUseTool;

  constructor(mode: PermissionMode = "default", canUseTool?: CanUseTool) {
    this.mode = mode;
    this.canUseTool = canUseTool;
  }

  async check(
    toolName: string,
    input: Record<string, unknown>,
    options: { signal: AbortSignal; toolUseId: string; agentId?: string },
  ): Promise<PermissionResult> {
    // bypassPermissions / dontAsk → allow everything
    if (this.mode === "bypassPermissions" || this.mode === "dontAsk") {
      return { behavior: "allow" };
    }

    // Plan mode → deny execution tools
    if (this.mode === "plan") {
      if (!SAFE_TOOLS.has(toolName)) {
        return {
          behavior: "deny",
          message: `Tool "${toolName}" is not allowed in plan mode. Only read-only tools are available.`,
        };
      }
      return { behavior: "allow" };
    }

    // Safe tools are always allowed
    if (SAFE_TOOLS.has(toolName)) {
      return { behavior: "allow" };
    }

    // acceptEdits → allow file edit tools too
    if (this.mode === "acceptEdits" && EDIT_TOOLS.has(toolName)) {
      return { behavior: "allow" };
    }

    // Custom permission callback
    if (this.canUseTool) {
      return this.canUseTool(toolName, input, options);
    }

    // Default mode with no callback → allow (the host app is responsible for permissions)
    return { behavior: "allow" };
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  getMode(): PermissionMode {
    return this.mode;
  }
}
