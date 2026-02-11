/**
 * Gemini provider adapter.
 *
 * Dual mode:
 *  1. API key  → @google/genai SDK (standard Gemini API)
 *  2. OAuth    → Direct HTTP to Code Assist endpoint (from `gemini login` CLI)
 *
 * Bridges the structural gap between Gemini's Content/Part format and the
 * SDK's Anthropic-normalized format (tool_use/tool_result content blocks).
 */

import { GoogleGenAI } from "@google/genai";
import type {
  ProviderAdapter,
  ChatRequest,
  ChatChunk,
  ProviderFeature,
  ToolDefinition,
  NormalizedMessage,
  StopReason,
} from "./types.ts";
import type { TokenUsage } from "../types.ts";
import {
  calculateGeminiCost,
  GEMINI_CONTEXT_WINDOWS,
  GEMINI_MAX_OUTPUT,
} from "../utils/cost.ts";

const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const CODE_ASSIST_API_VERSION = "v1internal";

export class GeminiAdapter implements ProviderAdapter {
  name = "gemini";
  private client: GoogleGenAI | null = null;
  private oauthMode: boolean;
  private currentAccessToken?: string;
  private projectId?: string;

  constructor(options?: { apiKey?: string; baseUrl?: string }) {
    const key = options?.apiKey ?? process.env.GEMINI_API_KEY;

    if (key) {
      // Standard API key mode → @google/genai SDK
      this.oauthMode = false;
      this.client = new GoogleGenAI({ apiKey: key });
    } else {
      // Try OAuth mode (gemini login) → Code Assist endpoint
      const tokens = loadTokensSync();
      if (tokens) {
        this.oauthMode = true;
        this.currentAccessToken = tokens.access_token;
      } else {
        // No auth — will fail on first request
        this.oauthMode = false;
        this.client = new GoogleGenAI({ apiKey: "" });
      }
    }
  }

  async *chat(request: ChatRequest): AsyncGenerator<ChatChunk> {
    if (this.oauthMode) {
      yield* this.chatCodeAssist(request);
    } else {
      yield* this.chatSdk(request);
    }
  }

  calculateCost(model: string, usage: TokenUsage): number {
    return calculateGeminiCost(model, usage);
  }

  getContextWindow(model: string): number {
    return GEMINI_CONTEXT_WINDOWS[model] ?? 1_048_576;
  }

  supportsFeature(feature: ProviderFeature): boolean {
    switch (feature) {
      case "streaming":
      case "tool_calling":
      case "image_input":
      case "structured_output":
      case "thinking":
      case "pdf_input":
        return true;
      default:
        return false;
    }
  }

  // ─── API key mode: @google/genai SDK ────────────────────────────────────

  private async *chatSdk(request: ChatRequest): AsyncGenerator<ChatChunk> {
    const contents = this.convertMessages(request.messages);
    const tools = request.tools ? this.convertTools(request.tools) : undefined;

    const maxTokens = request.maxTokens
      ?? GEMINI_MAX_OUTPUT[request.model]
      ?? 65_536;

    const config: Record<string, unknown> = {
      maxOutputTokens: maxTokens,
      abortSignal: request.signal ?? undefined,
    };

    if (request.systemPrompt) {
      config.systemInstruction = request.systemPrompt;
    }

    if (request.temperature !== undefined) {
      config.temperature = request.temperature;
    }

    if (tools) {
      config.tools = [{ functionDeclarations: tools }];
    }

    const stream = await this.client!.models.generateContentStream({
      model: request.model,
      contents,
      config,
    });

    let hasToolCalls = false;

    for await (const chunk of stream) {
      if (chunk.usageMetadata) {
        const u = chunk.usageMetadata;
        const cached = u.cachedContentTokenCount ?? 0;
        yield {
          type: "usage",
          usage: {
            inputTokens: (u.promptTokenCount ?? 0) - cached,
            outputTokens: u.candidatesTokenCount ?? 0,
            cacheReadInputTokens: cached,
            cacheCreationInputTokens: 0,
          },
        };
      }

      const candidate = chunk.candidates?.[0];
      if (!candidate?.content?.parts) continue;

      for (const part of candidate.content.parts) {
        if (part.text) {
          if (part.thought) {
            yield { type: "thinking_delta", text: part.text };
          } else {
            yield { type: "text_delta", text: part.text };
          }
        }

        if (part.functionCall) {
          hasToolCalls = true;
          yield {
            type: "tool_call",
            id: part.functionCall.id ?? crypto.randomUUID(),
            name: part.functionCall.name ?? "",
            input: part.functionCall.args ?? {},
          };
        }
      }

      if (candidate.finishReason) {
        yield {
          type: "done",
          stopReason: this.mapFinishReason(candidate.finishReason, hasToolCalls),
        };
        return;
      }
    }

    yield { type: "done", stopReason: hasToolCalls ? "tool_use" : "end_turn" };
  }

  // ─── OAuth mode: Direct HTTP to Code Assist endpoint ────────────────────

  private async *chatCodeAssist(request: ChatRequest): AsyncGenerator<ChatChunk> {
    await this.refreshTokenIfNeeded();
    await this.ensureProjectId();

    const contents = this.convertMessages(request.messages);
    const tools = request.tools ? this.convertTools(request.tools) : undefined;

    const maxTokens = request.maxTokens
      ?? GEMINI_MAX_OUTPUT[request.model]
      ?? 65_536;

    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: maxTokens,
    };
    if (request.temperature !== undefined) {
      generationConfig.temperature = request.temperature;
    }

    const innerRequest: Record<string, unknown> = {
      contents,
      generationConfig,
    };

    if (request.systemPrompt) {
      innerRequest.systemInstruction = {
        parts: [{ text: request.systemPrompt }],
      };
    }

    if (tools) {
      innerRequest.tools = [{ functionDeclarations: tools }];
    }

    const body = {
      model: request.model,
      project: this.projectId,
      request: innerRequest,
    };

    const url = `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:streamGenerateContent?alt=sse`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.currentAccessToken}`,
      },
      body: JSON.stringify(body),
      signal: request.signal ?? undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini Code Assist API error (${res.status}): ${text}`);
    }

    yield* this.parseSSEStream(res);
  }

  private async *parseSSEStream(res: Response): AsyncGenerator<ChatChunk> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let hasToolCalls = false;
    let dataLines: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          dataLines.push(line.slice(6));
        } else if (line.trim() === "" && dataLines.length > 0) {
          // Empty line = end of SSE event, parse accumulated data lines
          const json = dataLines.join("\n");
          dataLines = [];
          let obj: any;
          try {
            obj = JSON.parse(json);
          } catch {
            continue;
          }

          const response = obj.response ?? obj;
          const candidate = response?.candidates?.[0];

          if (candidate?.content?.parts) {
            for (const part of candidate.content.parts) {
              if (part.text) {
                if (part.thought) {
                  yield { type: "thinking_delta", text: part.text };
                } else {
                  yield { type: "text_delta", text: part.text };
                }
              }

              if (part.functionCall) {
                hasToolCalls = true;
                yield {
                  type: "tool_call",
                  id: part.functionCall.id ?? crypto.randomUUID(),
                  name: part.functionCall.name ?? "",
                  input: part.functionCall.args ?? {},
                };
              }
            }
          }

          if (response?.usageMetadata) {
            const u = response.usageMetadata;
            const cached = u.cachedContentTokenCount ?? 0;
            yield {
              type: "usage",
              usage: {
                inputTokens: (u.promptTokenCount ?? 0) - cached,
                outputTokens: u.candidatesTokenCount ?? 0,
                cacheReadInputTokens: cached,
                cacheCreationInputTokens: 0,
              },
            };
          }

          if (candidate?.finishReason) {
            yield {
              type: "done",
              stopReason: this.mapFinishReason(candidate.finishReason, hasToolCalls),
            };
            return;
          }
        }
      }
    }

    // Process any remaining data lines
    if (dataLines.length > 0) {
      const json = dataLines.join("\n");
      try {
        const obj = JSON.parse(json);
        const response = obj.response ?? obj;
        const candidate = response?.candidates?.[0];
        if (candidate?.finishReason) {
          yield {
            type: "done",
            stopReason: this.mapFinishReason(candidate.finishReason, hasToolCalls),
          };
          return;
        }
      } catch {}
    }

    yield { type: "done", stopReason: hasToolCalls ? "tool_use" : "end_turn" };
  }

  // ─── Token refresh (OAuth mode) ──────────────────────────────────────────

  private async refreshTokenIfNeeded(): Promise<void> {
    if (!this.oauthMode) return;
    try {
      const { getValidToken } = await import("../auth/gemini-oauth.ts");
      const result = await getValidToken();
      if (result && result.accessToken !== this.currentAccessToken) {
        this.currentAccessToken = result.accessToken;
      }
    } catch {
      // Token refresh failed — continue with current token
    }
  }

  // ─── Project ID resolution (OAuth mode) ──────────────────────────────────

  private async ensureProjectId(): Promise<void> {
    if (this.projectId) return;

    // Check environment variables first
    this.projectId =
      process.env.GOOGLE_CLOUD_PROJECT ??
      process.env.GOOGLE_CLOUD_PROJECT_ID ??
      undefined;
    if (this.projectId) return;

    // Call loadCodeAssist to get the auto-assigned project ID
    try {
      const res = await fetch(
        `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:loadCodeAssist`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.currentAccessToken}`,
          },
          body: JSON.stringify({
            metadata: {
              ideType: "IDE_UNSPECIFIED",
              platform: "PLATFORM_UNSPECIFIED",
              pluginType: "GEMINI",
            },
          }),
        },
      );

      if (res.ok) {
        const data = await res.json();
        this.projectId = data.cloudaicompanionProject;
      }
    } catch {
      // Project ID resolution failed — try without it
    }
  }

  // ─── Message conversion ──────────────────────────────────────────────────

  convertMessages(messages: NormalizedMessage[]): Array<{ role: string; parts: any[] }> {
    const result: Array<{ role: string; parts: any[] }> = [];

    for (const msg of messages) {
      if (typeof msg.content === "string") {
        result.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        });
        continue;
      }

      if (msg.role === "assistant") {
        const parts: any[] = [];

        for (const block of msg.content) {
          if (block.type === "text") {
            parts.push({ text: block.text });
          } else if (block.type === "tool_use") {
            parts.push({
              functionCall: {
                name: block.name,
                args: block.input as Record<string, unknown>,
              },
            });
          }
        }

        if (parts.length > 0) {
          result.push({ role: "model", parts });
        }
      } else {
        // User message — may contain text + tool_results
        const textParts: any[] = [];
        const functionResponseParts: any[] = [];

        for (const block of msg.content) {
          if (block.type === "text") {
            textParts.push({ text: block.text });
          } else if (block.type === "tool_result") {
            functionResponseParts.push({
              functionResponse: {
                name: findToolName(messages, block.tool_use_id) ?? "unknown",
                response: { result: block.content },
              },
            });
          }
        }

        // Function responses first (Gemini requires them after model's function call)
        if (functionResponseParts.length > 0) {
          result.push({ role: "user", parts: functionResponseParts });
        }

        if (textParts.length > 0) {
          result.push({ role: "user", parts: textParts });
        }
      }
    }

    return result;
  }

  // ─── Tool conversion ─────────────────────────────────────────────────────

  private convertTools(tools: ToolDefinition[]): Array<{
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
  }> {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    }));
  }

  // ─── Finish reason mapping ───────────────────────────────────────────────

  private mapFinishReason(reason: string, hasToolCalls: boolean): StopReason {
    if (hasToolCalls) return "tool_use";

    switch (reason) {
      case "STOP":
        return "end_turn";
      case "MAX_TOKENS":
        return "max_tokens";
      default:
        return "end_turn";
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function findToolName(messages: NormalizedMessage[], toolUseId: string): string | undefined {
  for (const msg of messages) {
    if (msg.role !== "assistant" || typeof msg.content === "string") continue;
    for (const block of msg.content) {
      if (block.type === "tool_use" && block.id === toolUseId) {
        return block.name;
      }
    }
  }
  return undefined;
}

function loadTokensSync(): { access_token: string; refresh_token: string } | null {
  const home = process.env.HOME ?? require("node:os").homedir();
  const path = `${home}/.gemini/oauth_creds.json`;

  try {
    const fs = require("node:fs");
    const raw = fs.readFileSync(path, "utf-8");
    const data = JSON.parse(raw);
    if (data.access_token && data.refresh_token) {
      return data;
    }
  } catch {
    // File doesn't exist or isn't valid JSON
  }

  return null;
}
