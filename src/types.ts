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
  | "dontAsk";

export type PermissionResult =
  | {
      behavior: "allow";
      updatedInput?: Record<string, unknown>;
    }
  | {
      behavior: "deny";
      message: string;
      interrupt?: boolean;
    };

export type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
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

// ─── Query Options ──────────────────────────────────────────────────────────

export type QueryOptions = {
  // Provider
  provider?: string;
  apiKey?: string;
  baseUrl?: string;

  // Core
  model?: string;
  cwd?: string;
  systemPrompt?: string;
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

  // Streaming
  includeStreamEvents?: boolean;

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
