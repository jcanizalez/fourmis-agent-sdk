/**
 * Provider adapter interface and related types.
 * Normalizes all LLM APIs into a common contract.
 */

import type { TokenUsage, ThinkingConfig, Effort, OutputFormat } from "../types.ts";

// ─── Tool Definition ────────────────────────────────────────────────────────

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

// ─── Normalized Messages ────────────────────────────────────────────────────

export type NormalizedRole = "user" | "assistant";

export type NormalizedTextContent = {
  type: "text";
  text: string;
};

export type NormalizedToolUseContent = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};

export type NormalizedToolResultContent = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

export type NormalizedContent =
  | NormalizedTextContent
  | NormalizedToolUseContent
  | NormalizedToolResultContent;

export type NormalizedMessage = {
  role: NormalizedRole;
  content: NormalizedContent[] | string;
};

// ─── Chat Request ───────────────────────────────────────────────────────────

export type ChatRequest = {
  model: string;
  messages: NormalizedMessage[];
  tools?: ToolDefinition[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  thinkingBudget?: number;
  thinking?: ThinkingConfig;
  effort?: Effort;
  outputFormat?: OutputFormat;
  signal?: AbortSignal;
  /**
   * Provider-specific native tools (e.g. Anthropic's memory_20250818).
   * These bypass the normal tool definition format and are passed directly
   * to the provider's API alongside converted regular tools.
   */
  nativeTools?: unknown[];
};

// ─── Chat Chunks (Streaming) ────────────────────────────────────────────────

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";

export type ChatChunk =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "thinking_delta"; text: string }
  | { type: "usage"; usage: TokenUsage }
  | { type: "done"; stopReason: StopReason };

// ─── Provider Features ──────────────────────────────────────────────────────

export type ProviderFeature =
  | "thinking"
  | "streaming"
  | "tool_calling"
  | "structured_output"
  | "image_input"
  | "pdf_input";

// ─── Model Info ─────────────────────────────────────────────────────────────

export type ModelInfo = {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
};

// ─── Provider Adapter Interface ─────────────────────────────────────────────

export interface ProviderAdapter {
  name: string;

  chat(request: ChatRequest): AsyncGenerator<ChatChunk>;
  calculateCost(model: string, usage: TokenUsage): number;
  getContextWindow(model: string): number;
  supportsFeature(feature: ProviderFeature): boolean;
  listModels?(): Promise<ModelInfo[]>;
}
