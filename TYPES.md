# Types Reference: Anthropic Agent SDK → fourmis-agents

Mapping every exported type from `@anthropic-ai/claude-agent-sdk` (v0.2.34) to its fourmis-agents equivalent.

---

## Message Types

### Anthropic: `SDKMessage` (union of 16 types)
### fourmis-agents: `AgentMessage` (union)

```ts
// fourmis-agents/src/types.ts

export type AgentMessage =
  // Core messages
  | InitMessage
  | TextMessage
  | ToolUseMessage
  | ToolResultMessage
  | StreamMessage
  | ResultMessage
  | ErrorMessage
  // System events
  | StatusMessage
  | CompactMessage
  | ToolProgressMessage
  | ToolSummaryMessage
  | TaskNotificationMessage
  | FilesPersistedMessage
  // Hook events
  | HookStartedMessage
  | HookProgressMessage
  | HookResponseMessage
  // User messages
  | UserMessage
  | UserReplayMessage;

// --- Core Messages ---

export type InitMessage = {
  type: "init";
  model: string;
  provider: string;
  tools: string[];
  mcpServers: { name: string; status: string }[];
  sessionId: string;
  uuid: string;
};

export type TextMessage = {
  type: "text";
  text: string;
  uuid: string;
  sessionId: string;
};

export type ToolUseMessage = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
  parentTaskId: string | null;
  uuid: string;
  sessionId: string;
};

export type ToolResultMessage = {
  type: "tool_result";
  id: string;
  name: string;
  result: string;
  isError: boolean;
  uuid: string;
  sessionId: string;
};

export type StreamMessage = {
  type: "stream";
  delta: TextDelta | ToolCallDelta | ThinkingDelta;
  uuid: string;
  sessionId: string;
};

export type TextDelta = { type: "text_delta"; text: string };
export type ToolCallDelta = { type: "tool_call_delta"; id: string; inputDelta: string };
export type ThinkingDelta = { type: "thinking_delta"; text: string };

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
  structuredOutput?: unknown;
  uuid: string;
};

export type ErrorMessage = {
  type: "result";
  subtype: "error_execution" | "error_max_turns" | "error_max_budget" | "error_max_retries";
  errors: string[];
  turns: number;
  costUsd: number;
  durationMs: number;
  sessionId: string;
  uuid: string;
};

// --- System Events ---

export type StatusMessage = {
  type: "status";
  status: "compacting" | null;
  uuid: string;
  sessionId: string;
};

export type CompactMessage = {
  type: "compact";
  metadata: { trigger: "manual" | "auto"; preTokens: number };
  uuid: string;
  sessionId: string;
};

export type ToolProgressMessage = {
  type: "tool_progress";
  toolUseId: string;
  toolName: string;
  parentTaskId: string | null;
  elapsedSeconds: number;
  uuid: string;
  sessionId: string;
};

export type ToolSummaryMessage = {
  type: "tool_summary";
  summary: string;
  precedingToolUseIds: string[];
  uuid: string;
  sessionId: string;
};

export type TaskNotificationMessage = {
  type: "task_notification";
  taskId: string;
  status: "completed" | "failed" | "stopped";
  outputFile: string;
  summary: string;
  uuid: string;
  sessionId: string;
};

export type FilesPersistedMessage = {
  type: "files_persisted";
  files: { filename: string; fileId: string }[];
  failed: { filename: string; error: string }[];
  processedAt: string;
  uuid: string;
  sessionId: string;
};

// --- Usage ---

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
};

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  contextWindow: number;
  maxOutputTokens: number;
  costUsd: number;
};
```

---

## Query Options

### Anthropic: `Options`
### fourmis-agents: `QueryOptions`

```ts
export type QueryOptions = {
  // Provider (NEW — not in Anthropic SDK)
  provider?: string;                    // "anthropic" | "openai" | "google" | "ollama" | custom
  apiKey?: string;                      // Provider API key (or use env vars)
  baseUrl?: string;                     // Custom API base URL

  // Core
  model?: string;
  cwd?: string;
  systemPrompt?: string | SystemPromptPreset;
  maxTurns?: number;
  maxBudgetUsd?: number;
  maxThinkingTokens?: number;
  outputFormat?: JsonSchemaOutput;

  // Tools
  tools?: string | string[];           // Preset name or tool name array
  allowedTools?: string[];
  disallowedTools?: string[];

  // Agents
  agent?: string;
  agents?: Record<string, AgentDefinition>;

  // Permissions
  permissionMode?: PermissionMode;
  canUseTool?: CanUseTool;

  // Sessions
  sessionId?: string;
  continue?: boolean;
  resume?: string;
  resumeSessionAt?: string;
  forkSession?: boolean;
  persistSession?: boolean;
  enableFileCheckpointing?: boolean;

  // MCP
  mcpServers?: Record<string, McpServerConfig>;
  strictMcpConfig?: boolean;

  // Hooks
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;

  // Sandbox
  sandbox?: SandboxSettings;

  // Context compaction
  compaction?: CompactionOptions;

  // Streaming
  includeStreamEvents?: boolean;        // Emit StreamMessage events

  // Debug
  debug?: boolean;
  debugFile?: string;
  signal?: AbortSignal;
  env?: Record<string, string>;

  // Additional directories
  additionalDirectories?: string[];
};

export type SystemPromptPreset = {
  type: "preset";
  preset: "coding";                    // Our preset (equivalent to claude_code)
  append?: string;
};

export type CompactionOptions = {
  enabled?: boolean;                   // Default: true
  threshold?: number;                  // Default: 0.85 (85% of context window)
  offloadThreshold?: number;           // Default: 20000 (tokens for tool result offloading)
  summarizeModel?: string;             // Model for summarization (defaults to cheaper model)
};
```

---

## Query Interface

### Anthropic: `Query extends AsyncGenerator<SDKMessage>`
### fourmis-agents: `Query extends AsyncGenerator<AgentMessage>`

```ts
export interface Query extends AsyncGenerator<AgentMessage, void> {
  // Control
  interrupt(): Promise<void>;
  setModel(model: string): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setMaxThinkingTokens(n: number | null): Promise<void>;
  compact(): Promise<void>;                      // Manual compaction trigger (NEW)

  // Information
  initializationResult(): Promise<InitResult>;
  supportedModels(): Promise<ModelInfo[]>;
  mcpServerStatus(): Promise<McpServerStatus[]>;

  // MCP management
  reconnectMcpServer(name: string): Promise<void>;
  toggleMcpServer(name: string, enabled: boolean): Promise<void>;
  setMcpServers(servers: Record<string, McpServerConfig>): Promise<McpSetResult>;

  // File management
  rewindFiles(messageId: string, options?: { dryRun?: boolean }): Promise<RewindResult>;

  // Multi-turn
  streamInput(stream: AsyncIterable<UserMessage>): Promise<void>;

  // Lifecycle
  close(): void;
}
```

---

## Agent Definitions

### Anthropic: `AgentDefinition`
### fourmis-agents: `AgentDefinition`

```ts
export type AgentDefinition = {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;                       // Any model string (not limited to sonnet/opus/haiku)
  provider?: string;                    // NEW: per-agent provider
  mcpServers?: McpServerSpec[];
  maxTurns?: number;
};
```

Key difference: `model` accepts any string (not locked to `'sonnet' | 'opus' | 'haiku' | 'inherit'`), and `provider` allows cross-provider subagents.

---

## MCP Server Configs

### Anthropic: 4 transports
### fourmis-agents: Same 4 transports

```ts
export type McpServerConfig =
  | McpStdioConfig
  | McpSseConfig
  | McpHttpConfig
  | McpSdkConfig;

export type McpStdioConfig = {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type McpSseConfig = {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
};

export type McpHttpConfig = {
  type: "http";
  url: string;
  headers?: Record<string, string>;
};

export type McpSdkConfig = {
  type: "sdk";
  name: string;
  instance: McpServer;
};
```

---

## Permission Types

```ts
export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan"
  | "dontAsk";

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

export type PermissionResult =
  | { behavior: "allow"; updatedInput?: Record<string, unknown>; updatedPermissions?: PermissionUpdate[] }
  | { behavior: "deny"; message: string; interrupt?: boolean };
```

---

## Hook Types

```ts
export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "Notification"
  | "UserPromptSubmit"
  | "SessionStart"
  | "SessionEnd"
  | "Stop"
  | "SubagentStart"
  | "SubagentStop"
  | "PreCompact"
  | "PermissionRequest"
  | "Setup"
  | "TeammateIdle"
  | "TaskCompleted";

export type HookCallbackMatcher = {
  matcher?: string;
  hooks: HookCallback[];
  timeout?: number;
};

export type HookCallback = (
  input: HookInput,
  toolUseId: string,
  options: { signal: AbortSignal },
) => Promise<HookOutput>;
```

---

## Sandbox Types

```ts
export type SandboxSettings = {
  enabled?: boolean;
  autoAllowBashIfSandboxed?: boolean;
  network?: {
    allowedDomains?: string[];
    allowManagedDomainsOnly?: boolean;
    allowLocalBinding?: boolean;
  };
  excludedCommands?: string[];
};
```

---

## Provider Adapter Interface (NEW — not in Anthropic SDK)

```ts
export interface ProviderAdapter {
  name: string;

  // Core: send messages, get streaming response
  chat(request: ChatRequest): AsyncGenerator<ChatChunk>;

  // Metadata
  calculateCost(usage: TokenUsage): number;
  getContextWindow(model: string): number;
  supportsFeature(feature: ProviderFeature): boolean;
  listModels?(): Promise<ModelInfo[]>;
}

export type ProviderFeature =
  | "thinking"
  | "streaming"
  | "tool_calling"
  | "structured_output"
  | "web_search"
  | "image_input"
  | "pdf_input";

export type ChatRequest = {
  model: string;
  messages: NormalizedMessage[];
  tools?: ToolDefinition[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  thinkingBudget?: number;
  outputFormat?: JsonSchemaOutput;
  signal?: AbortSignal;
};

export type ChatChunk =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_call_delta"; id: string; inputDelta: string }
  | { type: "thinking_delta"; text: string }
  | { type: "usage"; usage: TokenUsage }
  | { type: "done"; stopReason: StopReason };

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
```
