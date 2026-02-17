/**
 * Anthropic provider adapter.
 * Uses @anthropic-ai/sdk to call Claude models directly.
 *
 * Supports both API keys (sk-ant-api03-...) and OAuth setup-tokens
 * (sk-ant-oat...) from Claude Code / Claude Pro/Max subscriptions.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  ProviderAdapter,
  ChatRequest,
  ChatChunk,
  ProviderFeature,
  ToolDefinition,
  NormalizedMessage,
  NormalizedContent,
} from "./types.ts";
import type { TokenUsage } from "../types.ts";
import {
  calculateAnthropicCost,
  ANTHROPIC_CONTEXT_WINDOWS,
  ANTHROPIC_MAX_OUTPUT,
} from "../utils/cost.ts";

type AnthropicMessage = Anthropic.MessageParam;
type AnthropicTool = Anthropic.Tool;
type AnthropicContentBlock = Anthropic.ContentBlockParam;

function isOAuthToken(key: string): boolean {
  return key.includes("sk-ant-oat");
}

const CLAUDE_CODE_VERSION = "2.1.2";

export class AnthropicAdapter implements ProviderAdapter {
  name = "anthropic";
  private client: Anthropic;
  private oauthMode: boolean;

  constructor(options?: { apiKey?: string; baseUrl?: string }) {
    const key = options?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    this.oauthMode = isOAuthToken(key);

    if (this.oauthMode) {
      // OAuth token: mimic Claude Code's headers for compatibility
      this.client = new Anthropic({
        apiKey: null,
        authToken: key,
        baseURL: options?.baseUrl,
        defaultHeaders: {
          "anthropic-beta": "claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14",
          "user-agent": `claude-cli/${CLAUDE_CODE_VERSION} (external, cli)`,
          "x-app": "cli",
        },
      });
    } else {
      this.client = new Anthropic({
        apiKey: key || undefined,
        baseURL: options?.baseUrl,
      });
    }
  }

  async *chat(request: ChatRequest): AsyncGenerator<ChatChunk> {
    const messages = this.convertMessages(request.messages);
    const tools = request.tools ? this.convertTools(request.tools) : undefined;

    const maxTokens = request.maxTokens
      ?? ANTHROPIC_MAX_OUTPUT[request.model]
      ?? 16_384;

    const params: Anthropic.MessageCreateParamsStreaming = {
      model: request.model,
      messages,
      max_tokens: maxTokens,
      stream: true,
    };

    if (request.thinking) {
      switch (request.thinking.type) {
        case "adaptive":
          params.thinking = { type: "adaptive" };
          break;
        case "disabled":
          params.thinking = { type: "disabled" };
          break;
        case "enabled":
          params.thinking = {
            type: "enabled",
            budget_tokens: request.thinking.budgetTokens,
          };
          break;
      }
    } else if (request.thinkingBudget !== undefined) {
      if (request.thinkingBudget <= 0) {
        params.thinking = { type: "disabled" };
      } else {
        params.thinking = {
          type: "enabled",
          budget_tokens: Math.max(1024, request.thinkingBudget),
        };
      }
    }

    const outputConfig: { effort?: "low" | "medium" | "high" | "max"; format?: Anthropic.JSONOutputFormat } = {};
    if (request.effort) {
      outputConfig.effort = request.effort;
    }
    if (request.outputFormat?.type === "json_schema") {
      outputConfig.format = {
        type: "json_schema",
        schema: request.outputFormat.schema,
      };
    }
    if (Object.keys(outputConfig).length > 0) {
      params.output_config = outputConfig;
    }

    // OAuth tokens require the Claude Code identity in the system prompt
    if (this.oauthMode) {
      const systemBlocks: { type: "text"; text: string }[] = [
        { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
      ];
      if (request.systemPrompt) {
        systemBlocks.push({ type: "text", text: request.systemPrompt });
      }
      params.system = systemBlocks;
    } else if (request.systemPrompt) {
      params.system = request.systemPrompt;
    }

    // Build the combined tools array: regular tools + native tools (e.g. memory)
    const allTools: unknown[] = [];
    if (tools && tools.length > 0) {
      allTools.push(...tools);
    }
    if (request.nativeTools && request.nativeTools.length > 0) {
      allTools.push(...request.nativeTools);
    }
    if (allTools.length > 0) {
      params.tools = allTools as Anthropic.MessageCreateParamsStreaming["tools"];
    }

    if (request.temperature !== undefined) {
      params.temperature = request.temperature;
    }

    // Check if we need beta headers (e.g. memory tool)
    const hasMemoryTool = request.nativeTools?.some(
      (t: any) => t.type === "memory_20250818",
    );

    const requestOptions: Record<string, unknown> = {
      signal: request.signal,
    };
    if (hasMemoryTool) {
      requestOptions.headers = {
        "anthropic-beta": "context-management-2025-06-27",
      };
    }

    const stream = this.client.messages.stream(params, requestOptions as any);

    // Track accumulated tool call JSON for parsing
    const toolInputBuffers = new Map<number, { id: string; name: string; json: string }>();

    for await (const event of stream) {
      switch (event.type) {
        case "content_block_start": {
          const block = event.content_block;
          if (block.type === "tool_use") {
            toolInputBuffers.set(event.index, {
              id: block.id,
              name: block.name,
              json: "",
            });
          }
          break;
        }

        case "content_block_delta": {
          const delta = event.delta;
          if (delta.type === "text_delta") {
            yield { type: "text_delta", text: delta.text };
          } else if (delta.type === "input_json_delta") {
            const buffer = toolInputBuffers.get(event.index);
            if (buffer) {
              buffer.json += delta.partial_json;
            }
          } else if (delta.type === "thinking_delta" && "thinking" in delta) {
            yield { type: "thinking_delta", text: (delta as any).thinking };
          }
          break;
        }

        case "content_block_stop": {
          const buffer = toolInputBuffers.get(event.index);
          if (buffer) {
            let input: unknown;
            try {
              input = buffer.json ? JSON.parse(buffer.json) : {};
            } catch {
              input = {};
            }
            yield {
              type: "tool_call",
              id: buffer.id,
              name: buffer.name,
              input,
            };
            toolInputBuffers.delete(event.index);
          }
          break;
        }

        case "message_delta": {
          const stopReason = this.mapStopReason(event.delta.stop_reason);
          if (event.usage) {
            yield {
              type: "usage",
              usage: {
                inputTokens: 0,
                outputTokens: event.usage.output_tokens ?? 0,
                cacheReadInputTokens: 0,
                cacheCreationInputTokens: 0,
              },
            };
          }
          yield { type: "done", stopReason };
          break;
        }

        case "message_start": {
          if (event.message.usage) {
            yield {
              type: "usage",
              usage: {
                inputTokens: event.message.usage.input_tokens ?? 0,
                outputTokens: event.message.usage.output_tokens ?? 0,
                cacheReadInputTokens: (event.message.usage as any).cache_read_input_tokens ?? 0,
                cacheCreationInputTokens: (event.message.usage as any).cache_creation_input_tokens ?? 0,
              },
            };
          }
          break;
        }
      }
    }
  }

  calculateCost(model: string, usage: TokenUsage): number {
    return calculateAnthropicCost(model, usage);
  }

  getContextWindow(model: string): number {
    return ANTHROPIC_CONTEXT_WINDOWS[model] ?? 200_000;
  }

  supportsFeature(feature: ProviderFeature): boolean {
    switch (feature) {
      case "streaming":
      case "tool_calling":
      case "thinking":
      case "structured_output":
        return true;
      case "image_input":
      case "pdf_input":
        return false;
      default:
        return false;
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────

  private convertMessages(messages: NormalizedMessage[]): AnthropicMessage[] {
    return messages.map((msg) => {
      if (typeof msg.content === "string") {
        return { role: msg.role, content: msg.content };
      }

      const content: AnthropicContentBlock[] = msg.content.map((block) => {
        switch (block.type) {
          case "text":
            return { type: "text" as const, text: block.text };
          case "tool_use":
            return {
              type: "tool_use" as const,
              id: block.id,
              name: block.name,
              input: block.input as Record<string, unknown>,
            };
          case "tool_result":
            return {
              type: "tool_result" as const,
              tool_use_id: block.tool_use_id,
              content: block.content,
              is_error: block.is_error,
            };
          default:
            return { type: "text" as const, text: String(block) };
        }
      });

      return { role: msg.role, content };
    });
  }

  private convertTools(tools: ToolDefinition[]): AnthropicTool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
    }));
  }

  private mapStopReason(reason: string | null): ChatChunk & { type: "done" } extends { stopReason: infer R } ? R : never {
    switch (reason) {
      case "end_turn":
        return "end_turn";
      case "tool_use":
        return "tool_use";
      case "max_tokens":
        return "max_tokens";
      case "stop_sequence":
        return "stop_sequence";
      default:
        return "end_turn";
    }
  }
}
