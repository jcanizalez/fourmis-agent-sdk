/**
 * OpenAI provider adapter.
 * Uses the `openai` SDK to call GPT / o-series models.
 *
 * Dual mode:
 *  1. API key → Chat Completions API  (standard pay-per-token)
 *  2. Codex/OAuth → Responses API     (ChatGPT subscription, no per-token billing)
 *
 * Bridges the structural gap between OpenAI's message format (tool_calls on
 * assistant messages, separate role:"tool" messages) and the SDK's Anthropic-
 * normalized format (tool_use/tool_result content blocks).
 */

import OpenAI from "openai";
import type {
  ProviderAdapter,
  ChatRequest,
  ChatChunk,
  ProviderFeature,
  ToolDefinition,
  NormalizedMessage,
  NormalizedContent,
  NormalizedToolUseContent,
  NormalizedToolResultContent,
  StopReason,
} from "./types.ts";
import type { TokenUsage } from "../types.ts";
import {
  calculateOpenAICost,
  OPENAI_CONTEXT_WINDOWS,
  OPENAI_MAX_OUTPUT,
} from "../utils/cost.ts";

const CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
const CODEX_DEFAULT_MODEL = "gpt-5.3-codex";

// Models supported by the Codex subscription backend
const CODEX_MODELS = new Set([
  "gpt-5.3-codex",
  "gpt-5.2-codex",
  "gpt-5.1-codex-mini",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex",
  "gpt-5-codex",
  "gpt-5-codex-mini",
]);

type OAIMessage = OpenAI.ChatCompletionMessageParam;
type OAITool = OpenAI.ChatCompletionTool;

export class OpenAIAdapter implements ProviderAdapter {
  name = "openai";
  private client: OpenAI;
  private codexMode: boolean;
  private accountId?: string;
  private currentAccessToken?: string;

  constructor(options?: { apiKey?: string; baseUrl?: string }) {
    const key = options?.apiKey ?? process.env.OPENAI_API_KEY;

    if (key) {
      // Standard API key mode → Chat Completions API
      this.codexMode = false;
      this.client = new OpenAI({
        apiKey: key,
        baseURL: options?.baseUrl,
      });
    } else {
      // Try Codex/OAuth mode → Responses API
      const tokens = loadTokensSync();
      if (tokens) {
        this.codexMode = true;
        this.accountId = tokens.account_id;
        this.currentAccessToken = tokens.access_token;
        this.client = new OpenAI({
          apiKey: tokens.access_token,
          baseURL: options?.baseUrl ?? CODEX_BASE_URL,
          defaultHeaders: {
            "chatgpt-account-id": tokens.account_id,
            "originator": "codex_cli_rs",
          },
        });
      } else {
        // No auth at all — will fail on first request
        this.codexMode = false;
        this.client = new OpenAI({
          apiKey: undefined,
          baseURL: options?.baseUrl,
        });
      }
    }
  }

  async *chat(request: ChatRequest): AsyncGenerator<ChatChunk> {
    if (this.codexMode) {
      yield* this.chatResponses(request);
    } else {
      yield* this.chatCompletions(request);
    }
  }

  calculateCost(model: string, usage: TokenUsage): number {
    return calculateOpenAICost(model, usage);
  }

  getContextWindow(model: string): number {
    return OPENAI_CONTEXT_WINDOWS[model] ?? 128_000;
  }

  supportsFeature(feature: ProviderFeature): boolean {
    switch (feature) {
      case "streaming":
      case "tool_calling":
      case "image_input":
      case "structured_output":
        return true;
      case "thinking":
      case "pdf_input":
        return false;
      default:
        return false;
    }
  }

  // ─── Chat Completions API (standard API key mode) ─────────────────────────

  private async *chatCompletions(request: ChatRequest): AsyncGenerator<ChatChunk> {
    const messages = this.convertMessages(request.messages, request.systemPrompt);
    const tools = request.tools ? this.convertTools(request.tools) : undefined;

    const maxTokens = request.maxTokens
      ?? OPENAI_MAX_OUTPUT[request.model]
      ?? 16_384;

    const params: OpenAI.ChatCompletionCreateParamsStreaming = {
      model: request.model,
      messages,
      max_completion_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (tools && tools.length > 0) {
      params.tools = tools;
    }

    if (request.temperature !== undefined) {
      params.temperature = request.temperature;
    }

    const stream = await this.client.chat.completions.create(params, {
      signal: request.signal ?? undefined,
    });

    // Buffer tool calls — OpenAI streams them as indexed fragments
    const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>();
    let finishReason: string | null = null;

    for await (const chunk of stream) {
      // Usage arrives on the final chunk (choices may be empty)
      if (chunk.usage) {
        const cached = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
        yield {
          type: "usage",
          usage: {
            inputTokens: chunk.usage.prompt_tokens - cached,
            outputTokens: chunk.usage.completion_tokens,
            cacheReadInputTokens: cached,
            cacheCreationInputTokens: 0,
          },
        };
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;

      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
      }

      const delta = choice.delta;

      // Text content
      if (delta.content) {
        yield { type: "text_delta", text: delta.content };
      }

      // Tool call fragments
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallBuffers.has(idx)) {
            toolCallBuffers.set(idx, {
              id: tc.id ?? "",
              name: tc.function?.name ?? "",
              args: "",
            });
          }
          const buf = toolCallBuffers.get(idx)!;
          if (tc.id) buf.id = tc.id;
          if (tc.function?.name) buf.name = tc.function.name;
          if (tc.function?.arguments) buf.args += tc.function.arguments;
        }
      }
    }

    // Emit buffered tool calls after stream ends
    for (const [, buf] of toolCallBuffers) {
      let input: unknown;
      try {
        input = buf.args ? JSON.parse(buf.args) : {};
      } catch {
        input = {};
      }
      yield {
        type: "tool_call",
        id: buf.id,
        name: buf.name,
        input,
      };
    }

    yield { type: "done", stopReason: this.mapStopReason(finishReason) };
  }

  // ─── Responses API (Codex/OAuth subscription mode) ────────────────────────

  private async *chatResponses(request: ChatRequest): AsyncGenerator<ChatChunk> {
    await this.refreshTokenIfNeeded();

    const input = this.convertMessagesForResponses(request.messages);
    const tools = request.tools ? this.convertToolsForResponses(request.tools) : undefined;

    // Codex backend only supports specific models — fall back if needed
    const model = CODEX_MODELS.has(request.model) ? request.model : CODEX_DEFAULT_MODEL;

    const params: any = {
      model,
      input,
      instructions: request.systemPrompt || "You are a helpful coding assistant.",
      store: false,
      stream: true,
      // Note: Codex backend does not support max_output_tokens
    };

    if (tools && tools.length > 0) {
      params.tools = tools;
    }

    if (request.temperature !== undefined) {
      params.temperature = request.temperature;
    }

    const stream: any = await this.client.responses.create(params, {
      signal: request.signal ?? undefined,
    });

    for await (const event of stream) {
      switch (event.type) {
        case "response.output_text.delta":
          yield { type: "text_delta", text: event.delta };
          break;

        // Use output_item.done for tool calls — it has call_id and name
        case "response.output_item.done": {
          const item = event.item;
          if (item?.type === "function_call") {
            let parsedInput: unknown;
            try {
              parsedInput = item.arguments ? JSON.parse(item.arguments) : {};
            } catch {
              parsedInput = {};
            }
            yield {
              type: "tool_call",
              id: item.call_id,
              name: item.name,
              input: parsedInput,
            };
          }
          break;
        }

        case "response.completed": {
          const resp = event.response;
          if (resp?.usage) {
            const u = resp.usage;
            const cached = u.input_tokens_details?.cached_tokens ?? 0;
            yield {
              type: "usage",
              usage: {
                inputTokens: u.input_tokens - cached,
                outputTokens: u.output_tokens,
                cacheReadInputTokens: cached,
                cacheCreationInputTokens: 0,
              },
            };
          }
          yield { type: "done", stopReason: this.mapResponseStatus(resp) };
          break;
        }
      }
    }
  }

  // ─── Token refresh (Codex mode) ──────────────────────────────────────────

  private async refreshTokenIfNeeded(): Promise<void> {
    if (!this.codexMode) return;
    try {
      const { getValidToken } = await import("../auth/openai-oauth.ts");
      const tokens = await getValidToken();
      if (tokens && tokens.accessToken !== this.currentAccessToken) {
        this.currentAccessToken = tokens.accessToken;
        this.client = new OpenAI({
          apiKey: tokens.accessToken,
          baseURL: CODEX_BASE_URL,
          defaultHeaders: {
            "chatgpt-account-id": tokens.accountId,
            "originator": "codex_cli_rs",
          },
        });
      }
    } catch {
      // Token refresh failed — continue with current token
    }
  }

  // ─── Message conversion: Chat Completions API ────────────────────────────

  convertMessages(messages: NormalizedMessage[], systemPrompt?: string): OAIMessage[] {
    const result: OAIMessage[] = [];

    if (systemPrompt) {
      result.push({ role: "developer", content: systemPrompt });
    }

    for (const msg of messages) {
      // Simple string content
      if (typeof msg.content === "string") {
        result.push({ role: msg.role, content: msg.content });
        continue;
      }

      if (msg.role === "assistant") {
        // Split into text content + tool_calls
        const textParts: string[] = [];
        const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [];

        for (const block of msg.content) {
          if (block.type === "text") {
            textParts.push(block.text);
          } else if (block.type === "tool_use") {
            toolCalls.push({
              id: block.id,
              type: "function",
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input),
              },
            });
          }
        }

        const assistantMsg: OpenAI.ChatCompletionAssistantMessageParam = {
          role: "assistant",
          content: textParts.length > 0 ? textParts.join("") : null,
        };
        if (toolCalls.length > 0) {
          assistantMsg.tool_calls = toolCalls;
        }
        result.push(assistantMsg);
      } else {
        // User message — may contain text + tool_results
        const toolResults: NormalizedToolResultContent[] = [];
        const textParts: string[] = [];

        for (const block of msg.content) {
          if (block.type === "tool_result") {
            toolResults.push(block);
          } else if (block.type === "text") {
            textParts.push(block.text);
          }
        }

        // Emit tool results as separate role:"tool" messages
        for (const tr of toolResults) {
          result.push({
            role: "tool",
            tool_call_id: tr.tool_use_id,
            content: tr.content,
          });
        }

        // Emit remaining text as a user message
        if (textParts.length > 0) {
          result.push({ role: "user", content: textParts.join("") });
        }
      }
    }

    return result;
  }

  // ─── Message conversion: Responses API ────────────────────────────────────

  convertMessagesForResponses(messages: NormalizedMessage[]): any[] {
    const result: any[] = [];

    for (const msg of messages) {
      if (typeof msg.content === "string") {
        result.push({ role: msg.role, content: msg.content });
        continue;
      }

      if (msg.role === "assistant") {
        const textParts: string[] = [];
        const toolUses: NormalizedToolUseContent[] = [];

        for (const block of msg.content) {
          if (block.type === "text") {
            textParts.push(block.text);
          } else if (block.type === "tool_use") {
            toolUses.push(block);
          }
        }

        // Text → assistant message item
        if (textParts.length > 0) {
          result.push({
            role: "assistant",
            content: [{ type: "output_text", text: textParts.join("") }],
          });
        }

        // Tool uses → function_call items
        for (const tu of toolUses) {
          result.push({
            type: "function_call",
            call_id: tu.id,
            name: tu.name,
            arguments: JSON.stringify(tu.input),
          });
        }
      } else if (msg.role === "user") {
        const textParts: string[] = [];
        const toolResults: NormalizedToolResultContent[] = [];

        for (const block of msg.content) {
          if (block.type === "tool_result") {
            toolResults.push(block);
          } else if (block.type === "text") {
            textParts.push(block.text);
          }
        }

        // Tool results → function_call_output items
        for (const tr of toolResults) {
          result.push({
            type: "function_call_output",
            call_id: tr.tool_use_id,
            output: tr.content,
          });
        }

        // Remaining text → user message
        if (textParts.length > 0) {
          result.push({ role: "user", content: textParts.join("") });
        }
      }
    }

    return result;
  }

  // ─── Tool conversion ─────────────────────────────────────────────────────

  private convertTools(tools: ToolDefinition[]): OAITool[] {
    return tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  private convertToolsForResponses(tools: ToolDefinition[]): any[] {
    return tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      strict: false,
    }));
  }

  // ─── Stop reason mapping ──────────────────────────────────────────────────

  private mapStopReason(reason: string | null): StopReason {
    switch (reason) {
      case "stop":
        return "end_turn";
      case "tool_calls":
        return "tool_use";
      case "length":
        return "max_tokens";
      default:
        return "end_turn";
    }
  }

  private mapResponseStatus(response: any): StopReason {
    if (!response) return "end_turn";

    // Check if output contains function calls
    const hasToolCalls = response.output?.some?.(
      (item: any) => item.type === "function_call",
    );
    if (hasToolCalls) return "tool_use";

    if (response.status === "incomplete") {
      const reason = response.incomplete_details?.reason;
      if (reason === "max_output_tokens") return "max_tokens";
    }

    return "end_turn";
  }
}

// ─── Token storage helpers (sync read for constructor) ──────────────────────

type StoredTokens = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  account_id: string;
};

function loadTokensSync(): StoredTokens | null {
  const home = process.env.HOME ?? require("node:os").homedir();
  const paths = [
    `${home}/.fourmis/openai-auth.json`,
    `${home}/.codex/auth.json`,
  ];

  for (const p of paths) {
    try {
      const fs = require("node:fs");
      const raw = fs.readFileSync(p, "utf-8");
      const data = JSON.parse(raw);
      if (data.access_token && data.account_id) {
        return data as StoredTokens;
      }
    } catch {
      // File doesn't exist or isn't valid JSON — try next
    }
  }

  return null;
}
