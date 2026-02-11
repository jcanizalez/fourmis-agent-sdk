/**
 * Hook system — lifecycle callbacks for the agent loop.
 *
 * Hooks allow external code to observe and intervene at key points:
 * - PreToolUse: before a tool executes (can deny or modify input)
 * - PostToolUse: after a tool executes successfully
 * - PostToolUseFailure: after a tool fails or is denied
 * - SessionStart/SessionEnd: session lifecycle
 * - Stop: before the agent returns its final result
 * - Notification: informational events
 * - SubagentStart/SubagentStop: subagent lifecycle
 * - PreCompact: before context compaction
 * - PermissionRequest: when a permission decision is needed
 * - UserPromptSubmit: when a user prompt is submitted
 */

// ─── Hook Events ─────────────────────────────────────────────────────────────

export const HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "UserPromptSubmit",
  "SessionStart",
  "SessionEnd",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PermissionRequest",
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

// ─── Hook Input / Output ─────────────────────────────────────────────────────

export type HookInput = {
  /** The hook event type */
  event: HookEvent;
  /** Tool name (for tool-related events) */
  tool_name?: string;
  /** Tool input (for PreToolUse) */
  tool_input?: unknown;
  /** Tool result content (for PostToolUse/PostToolUseFailure) */
  tool_result?: string;
  /** Whether the tool result is an error (for PostToolUse/PostToolUseFailure) */
  tool_error?: boolean;
  /** Session ID */
  session_id?: string;
  /** Agent/subagent type (for SubagentStart/SubagentStop) */
  agent_type?: string;
  /** Stop reason (for Stop) */
  stop_reason?: string;
  /** Final text (for Stop) */
  text?: string;
  /** Arbitrary extra data */
  [key: string]: unknown;
};

export type SyncHookJSONOutput = {
  /** For PreToolUse: override the permission decision */
  permissionDecision?: "allow" | "deny";
  /** For PreToolUse: replace the tool input */
  updatedInput?: unknown;
  /** Additional context to append to the tool result */
  additionalContext?: string;
  /** For Stop: override the stop reason */
  stopReason?: string;
};

// ─── Hook Callback ───────────────────────────────────────────────────────────

export type HookCallback = (
  input: HookInput,
  toolUseId: string | undefined,
  opts: { signal: AbortSignal },
) => Promise<SyncHookJSONOutput>;

export type HookCallbackMatcher = {
  /** Regex pattern matched against tool_name. Empty/undefined = match all. */
  matcher?: string;
  /** Callbacks to run when the matcher matches. */
  hooks: HookCallback[];
};

// ─── Hook Manager ────────────────────────────────────────────────────────────

const TOOL_EVENTS = new Set<HookEvent>(["PreToolUse", "PostToolUse", "PostToolUseFailure"]);

export class HookManager {
  private hookMap: Partial<Record<HookEvent, HookCallbackMatcher[]>>;

  constructor(hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>) {
    this.hookMap = hooks ?? {};
  }

  hasHooks(event: HookEvent): boolean {
    const matchers = this.hookMap[event];
    return !!matchers && matchers.length > 0;
  }

  /**
   * Fire a hook event. Returns the merged output from all matching callbacks,
   * or null if no hooks are registered for this event.
   */
  async fire(
    event: HookEvent,
    input: HookInput,
    toolUseId?: string,
    opts?: { signal: AbortSignal },
  ): Promise<SyncHookJSONOutput | null> {
    const matchers = this.hookMap[event];
    if (!matchers || matchers.length === 0) return null;

    const signal = opts?.signal ?? new AbortController().signal;
    let merged: SyncHookJSONOutput = {};
    let hasOutput = false;

    for (const entry of matchers) {
      // For tool events, check matcher regex against tool_name
      if (TOOL_EVENTS.has(event) && entry.matcher) {
        const toolName = input.tool_name ?? "";
        try {
          const regex = new RegExp(entry.matcher);
          if (!regex.test(toolName)) continue;
        } catch {
          // Invalid regex → skip this matcher
          continue;
        }
      }

      // Run callbacks sequentially within a matcher
      for (const callback of entry.hooks) {
        const result = await callback(input, toolUseId, { signal });
        if (result) {
          hasOutput = true;

          // permissionDecision: first "deny" wins
          if (result.permissionDecision) {
            if (!merged.permissionDecision || result.permissionDecision === "deny") {
              merged.permissionDecision = result.permissionDecision;
            }
          }

          // updatedInput: last callback wins
          if (result.updatedInput !== undefined) {
            merged.updatedInput = result.updatedInput;
          }

          // additionalContext: concatenate
          if (result.additionalContext) {
            merged.additionalContext = merged.additionalContext
              ? `${merged.additionalContext}\n${result.additionalContext}`
              : result.additionalContext;
          }

          // stopReason: last callback wins
          if (result.stopReason) {
            merged.stopReason = result.stopReason;
          }
        }
      }
    }

    return hasOutput ? merged : null;
  }
}
