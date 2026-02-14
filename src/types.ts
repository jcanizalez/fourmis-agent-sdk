/**
 * Core types for fourmis-agents SDK.
 */

// ─── UUID ───────────────────────────────────────────────────────────────────

export function uuid(): string {
  return crypto.randomUUID();
}

// ─── Token Usage ────────────────────────────────────────────────────────────

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
};

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  totalCostUsd: number;
};

export function emptyTokenUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
}

export function mergeUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
  };
}

// ─── Permission Types ───────────────────────────────────────────────────────

export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan"
  | "delegate"
  | "dontAsk";

export type PermissionBehavior = "allow" | "deny" | "ask";

export type PermissionRuleValue = {
  toolName: string;
  ruleContent?: string;
};

export type PermissionUpdateDestination =
  | "userSettings"
  | "projectSettings"
  | "localSettings"
  | "session"
  | "cliArg";

export type PermissionUpdate =
  | { type: "addRules"; rules: PermissionRuleValue[]; behavior: PermissionBehavior; destination: PermissionUpdateDestination }
  | { type: "replaceRules"; rules: PermissionRuleValue[]; behavior: PermissionBehavior; destination: PermissionUpdateDestination }
  | { type: "removeRules"; rules: PermissionRuleValue[]; behavior: PermissionBehavior; destination: PermissionUpdateDestination }
  | { type: "setMode"; mode: PermissionMode; destination: PermissionUpdateDestination }
  | { type: "addDirectories"; directories: string[]; destination: PermissionUpdateDestination }
  | { type: "removeDirectories"; directories: string[]; destination: PermissionUpdateDestination };

export type PermissionResult =
  | {
      behavior: "allow";
      updatedInput?: Record<string, unknown>;
      updatedPermissions?: PermissionUpdate[];
      toolUseId?: string;
    }
  | {
      behavior: "deny";
      message: string;
      interrupt?: boolean;
      toolUseId?: string;
    };

export type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    suggestions?: PermissionUpdate[];
    blockedPath?: string;
    decisionReason?: string;
    toolUseId: string;
    agentId?: string;
  },
) => Promise<PermissionResult>;

// ─── Agent Messages ─────────────────────────────────────────────────────────

export type InitMessage = {
  type: "init";
  sessionId: string;
  model: string;
  provider: string;
  tools: string[];
  cwd: string;
  uuid: string;
};

export type TextMessage = {
  type: "text";
  text: string;
  uuid: string;
};

export type ToolUseMessage = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
  uuid: string;
};

export type ToolResultMessage = {
  type: "tool_result";
  id: string;
  name: string;
  content: string;
  isError?: boolean;
  uuid: string;
};

export type StreamMessage = {
  type: "stream";
  subtype: "text_delta" | "thinking_delta";
  text: string;
  uuid: string;
};

export type ResultMessage = {
  type: "result";
  subtype: "success";
  text: string | null;
  turns: number;
  costUsd: number;
  durationMs: number;
  durationApiMs: number;
  sessionId: string;
  usage: TokenUsage;
  modelUsage: Record<string, ModelUsage>;
  uuid: string;
};

export type ErrorMessage = {
  type: "result";
  subtype: "error_execution" | "error_max_turns" | "error_max_budget";
  errors: string[];
  turns: number;
  costUsd: number;
  durationMs: number;
  sessionId: string;
  uuid: string;
};

export type StatusMessage = {
  type: "status";
  status: string | null;
  uuid: string;
};

export type AgentMessage =
  | InitMessage
  | TextMessage
  | ToolUseMessage
  | ToolResultMessage
  | StreamMessage
  | ResultMessage
  | ErrorMessage
  | StatusMessage;

// ─── Permissions Config ─────────────────────────────────────────────────────

/**
 * Tool permission rules — same shape as Claude Code's settings.local.json.
 *
 * Accepts both simple tool names and rule objects with content patterns.
 *
 * @example
 * ```ts
 * // Simple: allow/deny by tool name
 * permissions: {
 *   allow: ["Read", "Glob", "Grep", "Write", "Edit"],
 *   deny: ["Bash"],
 * }
 *
 * // Advanced: allow specific patterns
 * permissions: {
 *   allow: [
 *     "Read",
 *     { toolName: "Bash", ruleContent: "npm test" },
 *     { toolName: "Bash", ruleContent: "ls *" },
 *   ],
 *   deny: ["WebFetch"],
 * }
 * ```
 */
export type PermissionsConfig = {
  /** Tool names or rules that are auto-approved (no prompting). */
  allow?: (string | PermissionRuleValue)[];
  /** Tool names or rules that are always denied. */
  deny?: (string | PermissionRuleValue)[];
};

// ─── Setting Source ─────────────────────────────────────────────────────────

export type SettingSource = "user" | "project" | "local";

// ─── Query Options ──────────────────────────────────────────────────────────

export type QueryOptions = {
  // Provider
  provider?: string;
  apiKey?: string;
  baseUrl?: string;

  // Core
  model?: string;
  cwd?: string;
  systemPrompt?: string;         // replaces default system prompt entirely
  appendSystemPrompt?: string;   // appended to the auto-built system prompt
  maxTurns?: number;
  maxBudgetUsd?: number;
  maxThinkingTokens?: number;

  // Tools
  tools?: string | string[];
  allowedTools?: string[];
  disallowedTools?: string[];

  // Permissions
  permissionMode?: PermissionMode;
  canUseTool?: CanUseTool;
  permissions?: PermissionsConfig;
  settingSources?: SettingSource[];

  // Session persistence
  persistSession?: boolean;     // default true — save to ~/.claude/projects/
  continue?: boolean;           // continue most recent session in cwd
  resume?: string;              // resume specific session by ID
  forkSession?: boolean;        // fork when resuming (new session, old messages as context)
  sessionId?: string;           // custom session ID

  // Streaming
  includeStreamEvents?: boolean;

  // Hooks
  hooks?: Partial<Record<import("./hooks.ts").HookEvent, import("./hooks.ts").HookCallbackMatcher[]>>;

  // MCP
  mcpServers?: Record<string, import("./mcp/types.ts").McpServerConfig>;

  // Subagents
  agents?: Record<string, import("./agents/types.ts").AgentDefinition>;

  // Skills
  /**
   * Paths to skill files or directories to load.
   * Skills are SKILL.md files with YAML frontmatter (name, description).
   * They get injected into the system prompt as available capabilities.
   *
   * By default, also scans ~/.claude/skills/ and .claude/skills/.
   * Set `includeDefaultSkills: false` to disable default locations.
   *
   * Matches the Claude SDK's skill loading behavior.
   */
  skillPaths?: string[];

  /**
   * Whether to include default skill directories (~/.claude/skills, .claude/skills).
   * Default: true
   */
  includeDefaultSkills?: boolean;

  // Memory
  /**
   * Absolute path to the memory directory.
   * When set, enables the memory tool for the agent.
   * For Anthropic: uses native memory_20250818 tool type.
   * For OpenAI/Gemini: registers a standard function tool.
   */
  memoryPath?: string;

  // Debug
  debug?: boolean;
  signal?: AbortSignal;
  env?: Record<string, string>;
};

// ─── Query Interface ────────────────────────────────────────────────────────

export interface Query extends AsyncIterable<AgentMessage> {
  next(...args: [] | [undefined]): Promise<IteratorResult<AgentMessage, void>>;
  return(value: void | PromiseLike<void>): Promise<IteratorResult<AgentMessage, void>>;
  throw(e: any): Promise<IteratorResult<AgentMessage, void>>;
  interrupt(): Promise<void>;
  close(): void;
}
