/**
 * Permission manager — controls which tools the agent can use.
 *
 * Supports:
 * - Permission modes (bypassPermissions, acceptEdits, plan, delegate, default, dontAsk)
 * - Permissions config with allow/deny rules (like Claude Code's settings.local.json)
 * - Custom canUseTool callback for dynamic permission decisions
 * - Rule-level granularity (e.g., allow Bash only for specific commands)
 */

import type {
  PermissionMode,
  PermissionResult,
  CanUseTool,
  PermissionsConfig,
  PermissionRuleValue,
  PermissionUpdate,
} from "./types.ts";
import type { SettingsManager } from "./settings.ts";

// Tools that are always safe (read-only, no side effects)
const SAFE_TOOLS = new Set(["Read", "Glob", "Grep", "WebFetch", "WebSearch"]);

// Tools that modify files but are reversible
const EDIT_TOOLS = new Set(["Write", "Edit", "NotebookEdit", "TodoWrite", "Config"]);

// Filesystem Bash commands auto-approved in acceptEdits mode
const FS_COMMANDS = ["mkdir", "touch", "rm", "mv", "cp"];

// Tools allowed in delegate mode (team leader only)
const DELEGATE_TOOLS = new Set(["Teammate", "Task", "TaskOutput", "TaskStop"]);

type NormalizedRule = { toolName: string; ruleContent?: string };

function normalizeRules(rules?: (string | PermissionRuleValue)[]): NormalizedRule[] {
  if (!rules) return [];
  return rules.map((r) =>
    typeof r === "string" ? { toolName: r } : r,
  );
}

function matchesRule(
  rules: NormalizedRule[],
  toolName: string,
  input?: Record<string, unknown>,
): boolean {
  for (const rule of rules) {
    if (rule.toolName !== toolName) continue;

    // No ruleContent → matches any input for this tool
    if (!rule.ruleContent) return true;

    // ruleContent → check if the input's command/content matches
    // For Bash, match against the "command" field
    // For other tools, match against JSON-serialized input
    const inputStr =
      toolName === "Bash"
        ? String((input as any)?.command ?? "")
        : JSON.stringify(input ?? {});

    if (inputStr.includes(rule.ruleContent)) return true;
  }
  return false;
}

export class PermissionManager {
  private mode: PermissionMode;
  private canUseTool?: CanUseTool;
  private allowRules: NormalizedRule[];
  private denyRules: NormalizedRule[];
  private settingsManager?: SettingsManager;

  constructor(
    mode: PermissionMode = "default",
    canUseTool?: CanUseTool,
    permissions?: PermissionsConfig,
    settingsManager?: SettingsManager,
  ) {
    this.mode = mode;
    this.canUseTool = canUseTool;
    this.allowRules = normalizeRules(permissions?.allow);
    this.denyRules = normalizeRules(permissions?.deny);
    this.settingsManager = settingsManager;
  }

  async check(
    toolName: string,
    input: Record<string, unknown>,
    options: { signal: AbortSignal; toolUseId: string; agentId?: string },
  ): Promise<PermissionResult> {
    // bypassPermissions / dontAsk → allow everything
    if (this.mode === "bypassPermissions") {
      return { behavior: "allow" };
    }

    // Explicit deny rules always win
    if (matchesRule(this.denyRules, toolName, input)) {
      return {
        behavior: "deny",
        message: `Tool "${toolName}" is denied by permissions config.`,
      };
    }

    // Plan mode → deny non-read-only tools
    if (this.mode === "plan") {
      if (!SAFE_TOOLS.has(toolName)) {
        return {
          behavior: "deny",
          message: `Tool "${toolName}" is not allowed in plan mode. Only read-only tools are available.`,
        };
      }
      return { behavior: "allow" };
    }

    // Delegate mode → only team coordination tools
    if (this.mode === "delegate") {
      if (!DELEGATE_TOOLS.has(toolName) && !SAFE_TOOLS.has(toolName)) {
        return {
          behavior: "deny",
          message: `Tool "${toolName}" is not allowed in delegate mode. Only Teammate, Task, and read-only tools are available.`,
        };
      }
      return { behavior: "allow" };
    }

    // Explicit allow rules → auto-approve
    if (matchesRule(this.allowRules, toolName, input)) {
      return { behavior: "allow" };
    }

    // Safe tools are always allowed
    if (SAFE_TOOLS.has(toolName)) {
      return { behavior: "allow" };
    }

    // acceptEdits → allow file edit tools + filesystem Bash commands
    if (this.mode === "acceptEdits") {
      if (EDIT_TOOLS.has(toolName)) {
        return { behavior: "allow" };
      }
      // Auto-approve filesystem Bash commands (mkdir, touch, rm, mv, cp)
      if (toolName === "Bash") {
        const cmd = String((input as any)?.command ?? "").trimStart();
        if (FS_COMMANDS.some((fc) => cmd.startsWith(fc + " ") || cmd === fc)) {
          return { behavior: "allow" };
        }
      }
    }

    // Custom permission callback
    if (this.canUseTool) {
      const result = await this.canUseTool(toolName, input, {
        ...options,
        toolUseID: options.toolUseId,
        agentID: options.agentId,
      });

      // Apply updatedPermissions if provided
      if (result.behavior === "allow" && result.updatedPermissions) {
        this.applyPermissionUpdates(result.updatedPermissions);
      }

      return result;
    }

    // dontAsk mode with no allow rule → deny
    if (this.mode === "dontAsk") {
      return {
        behavior: "deny",
        message: `Tool "${toolName}" requires approval. In dontAsk mode, tools must be pre-approved via permissions config.`,
      };
    }

    // Default mode with no callback → allow (the host app is responsible for permissions)
    return { behavior: "allow" };
  }

  /** Apply permission updates returned from canUseTool callback */
  private applyPermissionUpdates(updates: PermissionUpdate[]): void {
    for (const update of updates) {
      // Persist file-backed updates
      if (
        this.settingsManager &&
        update.destination !== "session" &&
        update.destination !== "cliArg"
      ) {
        this.settingsManager.persistUpdate(update);
      }

      // Apply in-memory for all destinations (so rules take effect immediately)
      switch (update.type) {
        case "addRules":
          for (const rule of update.rules) {
            if (update.behavior === "allow") {
              this.allowRules.push(rule);
            } else if (update.behavior === "deny") {
              this.denyRules.push(rule);
            }
          }
          break;
        case "removeRules":
          for (const rule of update.rules) {
            if (update.behavior === "allow") {
              this.allowRules = this.allowRules.filter(
                (r) => !(r.toolName === rule.toolName && r.ruleContent === rule.ruleContent),
              );
            } else if (update.behavior === "deny") {
              this.denyRules = this.denyRules.filter(
                (r) => !(r.toolName === rule.toolName && r.ruleContent === rule.ruleContent),
              );
            }
          }
          break;
        case "replaceRules":
          if (update.behavior === "allow") {
            this.allowRules = [...update.rules];
          } else if (update.behavior === "deny") {
            this.denyRules = [...update.rules];
          }
          break;
        case "setMode":
          this.mode = update.mode;
          break;
      }
    }
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  getMode(): PermissionMode {
    return this.mode;
  }
}
