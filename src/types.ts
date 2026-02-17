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
  webSearchRequests?: number;
};

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  totalCostUsd: number;
  webSearchRequests?: number;
  costUSD?: number;
  contextWindow?: number;
  maxOutputTokens?: number;
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
    toolUseID?: string;
    agentId?: string;
    agentID?: string;
  },
) => Promise<PermissionResult>;

// ─── SDK-Compatible Content Blocks ───────────────────────────────────────────

export type TextContent = {
  type: "text";
  text: string;
};

export type ToolUseContent = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};

export type ToolResultContent = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

export type ContentBlock = TextContent | ToolUseContent;

// ─── Claude SDK-Compatible Messages ─────────────────────────────────────────

export type ApiKeySource = "user" | "project" | "org" | "temporary";
export type SDKStatus = "compacting" | null;

export type SDKSystemMessage = {
  type: "system";
  subtype: "init";
  agents?: string[];
  apiKeySource: ApiKeySource;
  betas?: string[];
  claude_code_version: string;
  session_id: string;
  model: string;
  tools: string[];
  cwd: string;
  mcp_servers: { name: string; status: string }[];
  permissionMode: PermissionMode;
  slash_commands: string[];
  output_style: string;
  skills: string[];
  plugins: { name: string; path: string }[];
  uuid: string;
};

export type SDKStatusMessage = {
  type: "system";
  subtype: "status";
  status: SDKStatus;
  permissionMode?: PermissionMode;
  uuid: string;
  session_id: string;
};

export type SDKAssistantMessage = {
  type: "assistant";
  message: {
    role: "assistant";
    content: ContentBlock[];
  } & Record<string, unknown>;
  parent_tool_use_id: string | null;
  error?:
    | "authentication_failed"
    | "billing_error"
    | "rate_limit"
    | "invalid_request"
    | "server_error"
    | "unknown"
    | "max_output_tokens";
  uuid: string;
  session_id: string;
};

export type SDKUserMessage = {
  type: "user";
  message: {
    role: "user";
    content: ToolResultContent[] | TextContent[] | string;
  } & Record<string, unknown>;
  parent_tool_use_id: string | null;
  isSynthetic?: boolean;
  tool_use_result?: unknown;
  uuid?: string;
  session_id: string;
};

export type SDKUserMessageReplay = SDKUserMessage & {
  uuid: string;
  isReplay: true;
};

export type SDKStreamEvent = {
  type: string;
  [key: string]: unknown;
};

export type SDKPartialAssistantMessage = {
  type: "stream_event";
  event: SDKStreamEvent;
  parent_tool_use_id: string | null;
  uuid: string;
  session_id: string;
};

export type SDKToolProgressMessage = {
  type: "tool_progress";
  tool_use_id: string;
  tool_name: string;
  parent_tool_use_id: string | null;
  elapsed_time_seconds: number;
  uuid: string;
  session_id: string;
};

export type SDKToolUseSummaryMessage = {
  type: "tool_use_summary";
  summary: string;
  preceding_tool_use_ids: string[];
  uuid: string;
  session_id: string;
};

export type SDKTaskNotificationMessage = {
  type: "system";
  subtype: "task_notification";
  task_id: string;
  status: "completed" | "failed" | "stopped";
  output_file: string;
  summary: string;
  uuid: string;
  session_id: string;
};

export type SDKAuthStatusMessage = {
  type: "auth_status";
  isAuthenticating: boolean;
  output: string[];
  error?: string;
  uuid: string;
  session_id: string;
};

export type SDKCompactBoundaryMessage = {
  type: "system";
  subtype: "compact_boundary";
  compact_metadata: {
    trigger: "manual" | "auto";
    pre_tokens: number;
  };
  uuid: string;
  session_id: string;
};

export type SDKHookStartedMessage = {
  type: "system";
  subtype: "hook_started";
  hook_id: string;
  hook_name: string;
  hook_event: string;
  uuid: string;
  session_id: string;
};

export type SDKHookProgressMessage = {
  type: "system";
  subtype: "hook_progress";
  hook_id: string;
  hook_name: string;
  hook_event: string;
  stdout: string;
  stderr: string;
  output: string;
  uuid: string;
  session_id: string;
};

export type SDKHookResponseMessage = {
  type: "system";
  subtype: "hook_response";
  hook_id: string;
  hook_name: string;
  hook_event: string;
  output: string;
  stdout: string;
  stderr: string;
  exit_code?: number;
  outcome: "success" | "error" | "cancelled";
  uuid: string;
  session_id: string;
};

export type SDKFilesPersistedEvent = {
  type: "system";
  subtype: "files_persisted";
  files: { filename: string; file_id: string }[];
  failed: { filename: string; error: string }[];
  processed_at: string;
  uuid: string;
  session_id: string;
};

export type SDKPermissionDenial = {
  tool_name: string;
  tool_use_id: string;
  tool_input: Record<string, unknown>;
};

export type SDKResultSuccess = {
  type: "result";
  subtype: "success";
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  num_turns: number;
  result: string;
  stop_reason: string | null;
  total_cost_usd: number;
  usage: TokenUsage;
  modelUsage: Record<string, ModelUsage>;
  permission_denials: SDKPermissionDenial[];
  structured_output?: unknown;
  uuid: string;
  session_id: string;
};

export type SDKResultError = {
  type: "result";
  subtype:
    | "error_during_execution"
    | "error_max_turns"
    | "error_max_budget_usd"
    | "error_max_structured_output_retries";
  duration_ms: number;
  duration_api_ms: number;
  is_error: true;
  num_turns: number;
  stop_reason: string | null;
  total_cost_usd: number;
  usage: TokenUsage;
  modelUsage: Record<string, ModelUsage>;
  permission_denials: SDKPermissionDenial[];
  errors: string[];
  uuid: string;
  session_id: string;
};

export type SDKMessage =
  | SDKAuthStatusMessage
  | SDKSystemMessage
  | SDKStatusMessage
  | SDKCompactBoundaryMessage
  | SDKHookStartedMessage
  | SDKHookProgressMessage
  | SDKHookResponseMessage
  | SDKFilesPersistedEvent
  | SDKAssistantMessage
  | SDKUserMessage
  | SDKUserMessageReplay
  | SDKPartialAssistantMessage
  | SDKToolProgressMessage
  | SDKToolUseSummaryMessage
  | SDKTaskNotificationMessage
  | SDKResultSuccess
  | SDKResultError;

export type AgentMessage = SDKMessage;

// ─── Claude-Compatible Option Types ────────────────────────────────────────

export type SdkBeta = "context-1m-2025-08-07";

export type SdkPluginConfig = {
  type: "local";
  path: string;
};

export type OutputFormatType = "json_schema";

export type JsonSchemaOutputFormat = {
  type: "json_schema";
  schema: Record<string, unknown>;
};

export type OutputFormat = JsonSchemaOutputFormat;

export type ThinkingConfig =
  | { type: "adaptive" }
  | { type: "enabled"; budgetTokens: number }
  | { type: "disabled" };

export type Effort = "low" | "medium" | "high" | "max";

export type SandboxNetworkConfig = {
  allowedDomains?: string[];
  allowManagedDomainsOnly?: boolean;
  allowUnixSockets?: string[];
  allowAllUnixSockets?: boolean;
  allowLocalBinding?: boolean;
  httpProxyPort?: number;
  socksProxyPort?: number;
};

export type SandboxSettings = {
  enabled?: boolean;
  autoAllowBashIfSandboxed?: boolean;
  allowUnsandboxedCommands?: boolean;
  network?: SandboxNetworkConfig;
  ignoreViolations?: Record<string, string[]>;
  enableWeakerNestedSandbox?: boolean;
  excludedCommands?: string[];
  ripgrep?: { command: string; args?: string[] };
};

export type SystemPromptOption =
  | string
  | { type: "preset"; preset: "claude_code"; append?: string };

export type ToolsOption =
  | string[]
  | { type: "preset"; preset: "claude_code" };

export interface SpawnedProcess {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  readonly killed: boolean;
  readonly exitCode: number | null;
  kill(signal: NodeJS.Signals): boolean;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
}

export type SpawnOptions = {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
};

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
  abortController?: AbortController;
  additionalDirectories?: string[];
  agent?: string;

  // Core
  model?: string;
  fallbackModel?: string;
  cwd?: string;
  systemPrompt?: SystemPromptOption; // replaces default system prompt entirely
  appendSystemPrompt?: string;   // appended to the auto-built system prompt
  maxTurns?: number;
  maxBudgetUsd?: number;
  thinking?: ThinkingConfig;
  effort?: Effort;
  maxThinkingTokens?: number;
  outputFormat?: OutputFormat;
  betas?: SdkBeta[];
  executable?: "bun" | "deno" | "node";
  executableArgs?: string[];
  extraArgs?: Record<string, string | null>;
  pathToClaudeCodeExecutable?: string;
  spawnClaudeCodeProcess?: (options: SpawnOptions) => SpawnedProcess;

  // Tools
  tools?: ToolsOption;
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionPromptToolName?: string;

  // Permissions
  permissionMode?: PermissionMode;
  allowDangerouslySkipPermissions?: boolean;
  canUseTool?: CanUseTool;
  permissions?: PermissionsConfig;
  settingSources?: SettingSource[];
  enableFileCheckpointing?: boolean;
  sandbox?: SandboxSettings;

  // Session persistence
  persistSession?: boolean;     // default true — save to ~/.claude/projects/
  continue?: boolean;           // continue most recent session in cwd
  resume?: string;              // resume specific session by ID
  forkSession?: boolean;        // fork when resuming (new session, old messages as context)
  resumeSessionAt?: string;     // resume only up to a specific assistant message UUID
  sessionId?: string;           // custom session ID

  // Streaming
  includePartialMessages?: boolean;

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
  plugins?: SdkPluginConfig[];
  strictMcpConfig?: boolean;

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
  debugFile?: string;
  stderr?: (data: string) => void;
  signal?: AbortSignal;
  env?: Record<string, string>;
};

// ─── Query Control Types ────────────────────────────────────────────────────

export type SlashCommand = {
  name: string;
  description: string;
  argumentHint: string;
};

export type AccountInfo = {
  email?: string;
  organization?: string;
  subscriptionType?: string;
  tokenSource?: string;
  apiKeySource?: string;
};

export type RewindFilesResult = {
  canRewind: boolean;
  error?: string;
  filesChanged?: string[];
  insertions?: number;
  deletions?: number;
};

export type McpSetServersResult = {
  added: string[];
  removed: string[];
  errors: Record<string, string>;
};

export type QueryInitializationResult = {
  commands: SlashCommand[];
  output_style: string;
  available_output_styles: string[];
  models: import("./providers/types.ts").ModelInfo[];
  account: AccountInfo;
};

// ─── Query Interface ────────────────────────────────────────────────────────

export interface Query extends AsyncIterable<AgentMessage> {
  next(...args: [] | [undefined]): Promise<IteratorResult<AgentMessage, void>>;
  return(value: void | PromiseLike<void>): Promise<IteratorResult<AgentMessage, void>>;
  throw(e: any): Promise<IteratorResult<AgentMessage, void>>;
  interrupt(): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setModel(model?: string): Promise<void>;
  setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void>;
  initializationResult(): Promise<QueryInitializationResult>;
  supportedCommands(): Promise<SlashCommand[]>;
  supportedModels(): Promise<import("./providers/types.ts").ModelInfo[]>;
  mcpServerStatus(): Promise<import("./mcp/types.ts").McpServerStatus[]>;
  accountInfo(): Promise<AccountInfo>;
  rewindFiles(userMessageId: string, options?: { dryRun?: boolean }): Promise<RewindFilesResult>;
  reconnectMcpServer(serverName: string): Promise<void>;
  toggleMcpServer(serverName: string, enabled: boolean): Promise<void>;
  setMcpServers(
    servers: Record<string, import("./mcp/types.ts").McpServerConfig>,
  ): Promise<McpSetServersResult>;
  streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>;
  close(): void;
}
