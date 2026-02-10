/**
 * Agent loop — the core LLM ↔ tool execution engine.
 *
 * AsyncGenerator that orchestrates:
 *   1. Call LLM via provider adapter
 *   2. Stream text deltas as AgentMessage events
 *   3. Collect tool calls
 *   4. Execute tools with permission checks
 *   5. Feed results back to LLM
 *   6. Repeat until done or limits reached
 */

import type {
  AgentMessage,
  TokenUsage,
  ModelUsage,
} from "./types.ts";
import { uuid, emptyTokenUsage, mergeUsage } from "./types.ts";
import type { ProviderAdapter, NormalizedMessage, NormalizedContent, ChatChunk } from "./providers/types.ts";
import type { ToolRegistry, ToolContext } from "./tools/registry.ts";
import type { PermissionManager } from "./permissions.ts";

export type AgentLoopOptions = {
  provider: ProviderAdapter;
  model: string;
  systemPrompt: string;
  tools: ToolRegistry;
  permissions: PermissionManager;
  cwd: string;
  sessionId: string;
  maxTurns: number;
  maxBudgetUsd: number;
  includeStreamEvents: boolean;
  signal: AbortSignal;
  env?: Record<string, string>;
  debug?: boolean;
};

export async function* agentLoop(
  prompt: string,
  options: AgentLoopOptions,
): AsyncGenerator<AgentMessage> {
  const {
    provider,
    model,
    systemPrompt,
    tools,
    permissions,
    cwd,
    sessionId,
    maxTurns,
    maxBudgetUsd,
    includeStreamEvents,
    signal,
    env,
    debug,
  } = options;

  const startTime = Date.now();
  let apiTimeMs = 0;
  let turns = 0;
  let totalUsage = emptyTokenUsage();
  let costUsd = 0;
  const modelUsage: Record<string, ModelUsage> = {};

  // Initialize conversation with user prompt
  const messages: NormalizedMessage[] = [
    { role: "user", content: prompt },
  ];

  // Yield init event
  yield {
    type: "init",
    sessionId,
    model,
    provider: provider.name,
    tools: tools.list(),
    cwd,
    uuid: uuid(),
  };

  while (true) {
    // Check abort signal
    if (signal.aborted) {
      yield makeError("error_execution", ["Aborted"], turns, costUsd, sessionId, startTime);
      return;
    }

    // Check turn limit
    if (turns >= maxTurns) {
      yield makeError("error_max_turns", [`Reached maximum turns (${maxTurns})`], turns, costUsd, sessionId, startTime);
      return;
    }

    // Check budget limit
    if (maxBudgetUsd > 0 && costUsd >= maxBudgetUsd) {
      yield makeError("error_max_budget", [`Reached budget limit ($${maxBudgetUsd})`], turns, costUsd, sessionId, startTime);
      return;
    }

    // Call LLM
    const toolDefs = tools.getDefinitions();
    const apiStart = Date.now();

    let assistantTextParts: string[] = [];
    let toolCalls: { id: string; name: string; input: unknown }[] = [];
    let turnUsage = emptyTokenUsage();

    try {
      const chunks = provider.chat({
        model,
        messages,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        systemPrompt,
        signal,
      });

      for await (const chunk of chunks) {
        switch (chunk.type) {
          case "text_delta":
            assistantTextParts.push(chunk.text);
            if (includeStreamEvents) {
              yield { type: "stream", subtype: "text_delta", text: chunk.text, uuid: uuid() };
            }
            break;

          case "thinking_delta":
            if (includeStreamEvents) {
              yield { type: "stream", subtype: "thinking_delta", text: chunk.text, uuid: uuid() };
            }
            break;

          case "tool_call":
            toolCalls.push({ id: chunk.id, name: chunk.name, input: chunk.input });
            break;

          case "usage":
            turnUsage = mergeUsage(turnUsage, chunk.usage);
            break;

          case "done":
            // Streaming complete
            break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield makeError("error_execution", [`API error: ${message}`], turns, costUsd, sessionId, startTime);
      return;
    }

    apiTimeMs += Date.now() - apiStart;
    turns++;

    // Update usage tracking
    totalUsage = mergeUsage(totalUsage, turnUsage);
    const turnCost = provider.calculateCost(model, turnUsage);
    costUsd += turnCost;

    // Update per-model usage
    if (!modelUsage[model]) {
      modelUsage[model] = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        totalCostUsd: 0,
      };
    }
    modelUsage[model].inputTokens += turnUsage.inputTokens;
    modelUsage[model].outputTokens += turnUsage.outputTokens;
    modelUsage[model].cacheReadInputTokens += turnUsage.cacheReadInputTokens;
    modelUsage[model].cacheCreationInputTokens += turnUsage.cacheCreationInputTokens;
    modelUsage[model].totalCostUsd += turnCost;

    const assistantText = assistantTextParts.join("");

    // Build assistant message for conversation history
    const assistantContent: NormalizedContent[] = [];
    if (assistantText) {
      assistantContent.push({ type: "text", text: assistantText });
    }
    for (const call of toolCalls) {
      assistantContent.push({
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: call.input,
      });
    }
    messages.push({ role: "assistant", content: assistantContent });

    // Yield text message if there's text
    if (assistantText) {
      yield { type: "text", text: assistantText, uuid: uuid() };
    }

    // If no tool calls → we're done
    if (toolCalls.length === 0) {
      yield {
        type: "result",
        subtype: "success",
        text: assistantText || null,
        turns,
        costUsd,
        durationMs: Date.now() - startTime,
        durationApiMs: apiTimeMs,
        sessionId,
        usage: totalUsage,
        modelUsage,
        uuid: uuid(),
      };
      return;
    }

    // Execute tool calls
    const toolResults: NormalizedContent[] = [];

    for (const call of toolCalls) {
      // Permission check
      const permResult = await permissions.check(
        call.name,
        (call.input ?? {}) as Record<string, unknown>,
        { signal, toolUseId: call.id },
      );

      if (permResult.behavior === "deny") {
        yield {
          type: "tool_result",
          id: call.id,
          name: call.name,
          content: `Permission denied: ${permResult.message}`,
          isError: true,
          uuid: uuid(),
        };
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: `Permission denied: ${permResult.message}`,
          is_error: true,
        });
        continue;
      }

      // Use potentially updated input
      const toolInput = permResult.behavior === "allow" && permResult.updatedInput
        ? permResult.updatedInput
        : call.input;

      // Yield tool_use event
      yield {
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: toolInput,
        uuid: uuid(),
      };

      // Execute tool
      const toolCtx: ToolContext = {
        cwd,
        signal,
        sessionId,
        env,
      };

      const result = await tools.execute(call.name, toolInput, toolCtx);

      if (debug) {
        console.error(`[debug] Tool ${call.name}: ${result.isError ? "ERROR" : "OK"} (${result.content.length} chars)`);
      }

      // Yield tool_result event
      yield {
        type: "tool_result",
        id: call.id,
        name: call.name,
        content: result.content,
        isError: result.isError,
        uuid: uuid(),
      };

      toolResults.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: result.content,
        is_error: result.isError,
      });
    }

    // Add tool results as user message
    messages.push({ role: "user", content: toolResults });
  }
}

function makeError(
  subtype: "error_execution" | "error_max_turns" | "error_max_budget",
  errors: string[],
  turns: number,
  costUsd: number,
  sessionId: string,
  startTime: number,
): AgentMessage {
  return {
    type: "result",
    subtype,
    errors,
    turns,
    costUsd,
    durationMs: Date.now() - startTime,
    sessionId,
    uuid: uuid(),
  };
}
