/**
 * Agent loop — the core LLM ↔ tool execution engine.
 *
 * AsyncGenerator that orchestrates:
 *   1. Call LLM via provider adapter
 *   2. Stream partial assistant deltas (optional)
 *   3. Collect tool calls
 *   4. Execute tools with permission checks
 *   5. Feed results back to LLM
 *   6. Repeat until done or limits reached
 */

import type {
  AgentMessage,
  TokenUsage,
  ModelUsage,
  SDKPermissionDenial,
  ContentBlock,
  ToolResultContent,
  OutputFormat,
  ThinkingConfig,
  Effort,
  PermissionMode,
  SdkBeta,
  SdkPluginConfig,
} from "./types.ts";
import { uuid, emptyTokenUsage, mergeUsage } from "./types.ts";
import type { ProviderAdapter, NormalizedMessage, NormalizedContent } from "./providers/types.ts";
import type { ToolRegistry, ToolContext } from "./tools/registry.ts";
import type { PermissionManager } from "./permissions.ts";
import type { HookManager } from "./hooks.ts";
import type { McpClientManager } from "./mcp/client.ts";
import type { NativeMemoryTool } from "./memory/index.ts";
import type { MemoryCommand } from "./memory/index.ts";

export type SessionLogger = (
  role: "user" | "assistant",
  content: NormalizedContent[] | string,
  parentUuid: string | null,
) => string;

export type AgentLoopOptions = {
  provider: ProviderAdapter;
  model: string;
  fallbackModel?: string;
  modelState?: { current: string };
  maxThinkingTokensState?: { current: number | undefined };
  thinking?: ThinkingConfig;
  effort?: Effort;
  outputFormat?: OutputFormat;
  systemPrompt: string;
  tools: ToolRegistry;
  permissions: PermissionManager;
  cwd: string;
  sessionId: string;
  maxTurns: number;
  maxBudgetUsd: number;
  includePartialMessages: boolean;
  signal: AbortSignal;
  env?: Record<string, string>;
  debug?: boolean;
  hooks?: HookManager;
  mcpClient?: McpClientManager;
  previousMessages?: NormalizedMessage[];
  sessionLogger?: SessionLogger;
  /** Native memory tool for Anthropic provider (handled specially) */
  nativeMemoryTool?: NativeMemoryTool;
  initMeta?: {
    agents?: string[];
    betas?: SdkBeta[];
    slashCommands?: string[];
    outputStyle?: string;
    skills?: string[];
    plugins?: SdkPluginConfig[];
  };
};

function makeModelUsageEntry(): ModelUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    totalCostUsd: 0,
  };
}

function makeErrorResult(params: {
  subtype:
    | "error_during_execution"
    | "error_max_turns"
    | "error_max_budget_usd"
    | "error_max_structured_output_retries";
  errors: string[];
  turns: number;
  costUsd: number;
  sessionId: string;
  startTime: number;
  apiTimeMs: number;
  usage: TokenUsage;
  modelUsage: Record<string, ModelUsage>;
  permissionDenials: SDKPermissionDenial[];
}): AgentMessage {
  return {
    type: "result",
    subtype: params.subtype,
    duration_ms: Date.now() - params.startTime,
    duration_api_ms: params.apiTimeMs,
    is_error: true,
    num_turns: params.turns,
    stop_reason: null,
    total_cost_usd: params.costUsd,
    usage: params.usage,
    modelUsage: params.modelUsage,
    permission_denials: params.permissionDenials,
    errors: params.errors,
    uuid: uuid(),
    session_id: params.sessionId,
  };
}

function extractStructuredJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, error: "Empty result text; expected JSON output." };
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Invalid JSON output: ${message}` };
  }
}

export async function* agentLoop(
  prompt: string,
  options: AgentLoopOptions,
): AsyncGenerator<AgentMessage> {
  const {
    provider,
    model,
    fallbackModel,
    modelState,
    maxThinkingTokensState,
    thinking,
    effort,
    outputFormat,
    systemPrompt,
    tools,
    permissions,
    cwd,
    sessionId,
    maxTurns,
    maxBudgetUsd,
    includePartialMessages,
    signal,
    env,
    debug,
    hooks,
    mcpClient,
    previousMessages,
    sessionLogger,
    nativeMemoryTool,
    initMeta,
  } = options;

  const effectiveModelState = modelState ?? { current: model };

  const startTime = Date.now();
  let apiTimeMs = 0;
  let turns = 0;
  let totalUsage = emptyTokenUsage();
  let costUsd = 0;
  const modelUsage: Record<string, ModelUsage> = {};
  const permissionDenials: SDKPermissionDenial[] = [];

  // Connect MCP servers and register their tools
  if (mcpClient) {
    await mcpClient.connectAll();
    for (const tool of mcpClient.getTools()) {
      tools.register(tool);
    }
    // Lazy import to avoid circular deps
    const { createListMcpResourcesTool, createReadMcpResourceTool } = await import("./tools/mcp-resources.ts");
    tools.register(createListMcpResourcesTool(mcpClient));
    tools.register(createReadMcpResourceTool(mcpClient));
  }

  // Initialize conversation: previous messages (from session) + new user prompt
  const messages: NormalizedMessage[] = [
    ...(previousMessages ?? []),
    { role: "user", content: prompt },
  ];

  // Log the user prompt to session file
  if (sessionLogger) {
    sessionLogger("user", prompt, null);
  }

  // Yield Claude-compatible init event
  yield {
    type: "system",
    subtype: "init",
    apiKeySource: "user",
    claude_code_version: "fourmis-agent-sdk",
    session_id: sessionId,
    model: effectiveModelState.current,
    tools: tools.list(),
    cwd,
    mcp_servers: (mcpClient?.status() ?? []).map((s) => ({ name: s.name, status: s.status })),
    permissionMode: permissions.getMode(),
    agents: initMeta?.agents,
    betas: initMeta?.betas,
    slash_commands: initMeta?.slashCommands ?? [],
    output_style: initMeta?.outputStyle ?? "default",
    skills: initMeta?.skills ?? [],
    plugins: (initMeta?.plugins ?? []).map((p) => ({ name: p.path.split("/").pop() ?? p.path, path: p.path })),
    uuid: uuid(),
  };

  // Fire Setup hook
  if (hooks) {
    await hooks.fire("Setup", {
      event: "Setup",
      hook_event_name: "Setup",
      trigger: "init",
      session_id: sessionId,
      cwd,
      permission_mode: permissions.getMode(),
    }, undefined, { signal });
  }

  // Fire SessionStart hook
  if (hooks) {
    await hooks.fire("SessionStart", {
      event: "SessionStart",
      hook_event_name: "SessionStart",
      session_id: sessionId,
      source: "startup",
      model: effectiveModelState.current,
      cwd,
      permission_mode: permissions.getMode(),
    }, undefined, { signal });
  }

  while (true) {
    // Check abort signal
    if (signal.aborted) {
      yield makeErrorResult({
        subtype: "error_during_execution",
        errors: ["Aborted"],
        turns,
        costUsd,
        sessionId,
        startTime,
        apiTimeMs,
        usage: totalUsage,
        modelUsage,
        permissionDenials,
      });
      return;
    }

    // Check turn limit
    if (turns >= maxTurns) {
      yield makeErrorResult({
        subtype: "error_max_turns",
        errors: [`Reached maximum turns (${maxTurns})`],
        turns,
        costUsd,
        sessionId,
        startTime,
        apiTimeMs,
        usage: totalUsage,
        modelUsage,
        permissionDenials,
      });
      return;
    }

    // Check budget limit
    if (maxBudgetUsd > 0 && costUsd >= maxBudgetUsd) {
      yield makeErrorResult({
        subtype: "error_max_budget_usd",
        // Anthropic SDK reports budget exhaustion via subtype only.
        errors: [],
        turns,
        costUsd,
        sessionId,
        startTime,
        apiTimeMs,
        usage: totalUsage,
        modelUsage,
        permissionDenials,
      });
      return;
    }

    // Call LLM
    const activeModel = effectiveModelState.current;
    const toolDefs = tools.getDefinitions();
    const apiStart = Date.now();

    let assistantTextParts: string[] = [];
    const toolCalls: { id: string; name: string; input: unknown }[] = [];
    let turnUsage = emptyTokenUsage();
    let turnStopReason: string | null = null;

    // Build native tools array for the provider (e.g. Anthropic memory tool)
    const nativeTools: unknown[] | undefined = nativeMemoryTool
      ? [nativeMemoryTool.definition]
      : undefined;

    try {
      const chunks = provider.chat({
        model: activeModel,
        messages,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        systemPrompt,
        signal,
        nativeTools,
        thinkingBudget: maxThinkingTokensState?.current,
        thinking,
        effort,
        outputFormat,
      });

      for await (const chunk of chunks) {
        switch (chunk.type) {
          case "text_delta":
            assistantTextParts.push(chunk.text);
            if (includePartialMessages) {
              yield {
                type: "stream_event",
                event: { type: "text_delta", text: chunk.text },
                parent_tool_use_id: null,
                uuid: uuid(),
                session_id: sessionId,
              };
            }
            break;

          case "thinking_delta":
            if (includePartialMessages) {
              yield {
                type: "stream_event",
                event: { type: "thinking_delta", thinking: chunk.text },
                parent_tool_use_id: null,
                uuid: uuid(),
                session_id: sessionId,
              };
            }
            break;

          case "tool_call":
            toolCalls.push({ id: chunk.id, name: chunk.name, input: chunk.input });
            break;

          case "usage":
            turnUsage = mergeUsage(turnUsage, chunk.usage);
            break;

          case "done":
            turnStopReason = chunk.stopReason ?? null;
            break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (fallbackModel && activeModel !== fallbackModel) {
        effectiveModelState.current = fallbackModel;
        yield {
          type: "system",
          subtype: "status",
          status: null,
          permissionMode: permissions.getMode(),
          uuid: uuid(),
          session_id: sessionId,
        };
        continue;
      }

      yield makeErrorResult({
        subtype: "error_during_execution",
        errors: [`API error: ${message}`],
        turns,
        costUsd,
        sessionId,
        startTime,
        apiTimeMs,
        usage: totalUsage,
        modelUsage,
        permissionDenials,
      });
      return;
    }

    apiTimeMs += Date.now() - apiStart;
    turns++;

    // Update usage tracking
    totalUsage = mergeUsage(totalUsage, turnUsage);
    const turnCost = provider.calculateCost(activeModel, turnUsage);
    costUsd += turnCost;

    // Update per-model usage
    if (!modelUsage[activeModel]) {
      modelUsage[activeModel] = makeModelUsageEntry();
    }
    modelUsage[activeModel].inputTokens += turnUsage.inputTokens;
    modelUsage[activeModel].outputTokens += turnUsage.outputTokens;
    modelUsage[activeModel].cacheReadInputTokens += turnUsage.cacheReadInputTokens;
    modelUsage[activeModel].cacheCreationInputTokens += turnUsage.cacheCreationInputTokens;
    modelUsage[activeModel].totalCostUsd += turnCost;
    modelUsage[activeModel].webSearchRequests = (modelUsage[activeModel].webSearchRequests ?? 0) + (turnUsage.webSearchRequests ?? 0);
    modelUsage[activeModel].costUSD = modelUsage[activeModel].totalCostUsd;
    modelUsage[activeModel].contextWindow = provider.getContextWindow(activeModel);

    const assistantText = assistantTextParts.join("");

    // Build assistant message for conversation history
    const assistantContent: ContentBlock[] = [];
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

    // Log assistant message to session
    if (sessionLogger) {
      sessionLogger("assistant", assistantContent, null);
    }

    // Emit Claude-compatible assistant envelope
    yield {
      type: "assistant",
      message: {
        role: "assistant",
        content: assistantContent,
      },
      parent_tool_use_id: null,
      uuid: uuid(),
      session_id: sessionId,
    };

    // If no tool calls -> we're done
    if (toolCalls.length === 0) {
      let structuredOutput: unknown | undefined;
      if (outputFormat?.type === "json_schema") {
        const parsed = extractStructuredJson(assistantText);
        if (!parsed.ok) {
          yield makeErrorResult({
            subtype: "error_max_structured_output_retries",
            errors: [parsed.error],
            turns,
            costUsd,
            sessionId,
            startTime,
            apiTimeMs,
            usage: totalUsage,
            modelUsage,
            permissionDenials,
          });
          return;
        }
        structuredOutput = parsed.value;
      }

      // Fire Stop hook
      if (hooks) {
        await hooks.fire("Stop", {
          event: "Stop",
          hook_event_name: "Stop",
          session_id: sessionId,
          text: assistantText || undefined,
          stop_reason: turnStopReason ?? undefined,
        }, undefined, {
          signal,
        });
      }
      // Fire SessionEnd hook
      if (hooks) {
        await hooks.fire("SessionEnd", {
          event: "SessionEnd",
          hook_event_name: "SessionEnd",
          session_id: sessionId,
          reason: "other",
        }, undefined, { signal });
      }

      yield {
        type: "result",
        subtype: "success",
        duration_ms: Date.now() - startTime,
        duration_api_ms: apiTimeMs,
        is_error: false,
        num_turns: turns,
        result: assistantText,
        stop_reason: turnStopReason,
        total_cost_usd: costUsd,
        usage: totalUsage,
        modelUsage,
        permission_denials: permissionDenials,
        structured_output: structuredOutput,
        uuid: uuid(),
        session_id: sessionId,
      };
      return;
    }

    // Execute tool calls
    const toolResults: ToolResultContent[] = [];

    for (const call of toolCalls) {
      // Fire PreToolUse hook
      let hookDenied = false;
      let hookUpdatedInput: unknown | undefined;
      if (hooks) {
        const hookResult = await hooks.fire(
          "PreToolUse",
          {
            event: "PreToolUse",
            hook_event_name: "PreToolUse",
            tool_name: call.name,
            tool_input: call.input,
            session_id: sessionId,
          },
          call.id,
          { signal },
        );
        if (hookResult) {
          if (hookResult.permissionDecision === "deny") {
            hookDenied = true;
          }
          if (hookResult.updatedInput !== undefined) {
            hookUpdatedInput = hookResult.updatedInput;
          }
        }
      }

      // If hook denied, skip execution and emit a tool_result block
      if (hookDenied) {
        const denyContent = "Denied by hook";
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: denyContent,
          is_error: true,
        });
        if (hooks) {
          await hooks.fire(
            "PostToolUseFailure",
            { event: "PostToolUseFailure", tool_name: call.name, tool_result: denyContent, tool_error: true, session_id: sessionId },
            call.id,
            { signal },
          );
        }
        continue;
      }

      // Apply hook's updated input if provided
      const inputAfterHook = hookUpdatedInput !== undefined ? hookUpdatedInput : call.input;

      // Permission check
      const permResult = await permissions.check(
        call.name,
        (inputAfterHook ?? {}) as Record<string, unknown>,
        { signal, toolUseId: call.id },
      );

      if (permResult.behavior === "deny") {
        const denyContent = `Permission denied: ${permResult.message}`;
        permissionDenials.push({
          tool_name: call.name,
          tool_use_id: call.id,
          tool_input: (inputAfterHook ?? {}) as Record<string, unknown>,
        });

        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: denyContent,
          is_error: true,
        });

        if (hooks) {
          await hooks.fire(
            "PostToolUseFailure",
            { event: "PostToolUseFailure", tool_name: call.name, tool_result: denyContent, tool_error: true, session_id: sessionId },
            call.id,
            { signal },
          );
        }
        continue;
      }

      // Use potentially updated input from permissions
      const toolInput = permResult.behavior === "allow" && permResult.updatedInput
        ? permResult.updatedInput
        : inputAfterHook;

      // Execute tool — route memory tool calls to the native handler if available
      let result: { content: string; isError?: boolean };

      if (call.name === "memory" && nativeMemoryTool) {
        // Native memory tool (Anthropic): execute via memory handler
        try {
          const content = await nativeMemoryTool.execute(toolInput as MemoryCommand);
          result = { content, isError: content.startsWith("Error:") };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          result = { content: `Error: ${message}`, isError: true };
        }
      } else {
        // Regular tool execution
        const toolCtx: ToolContext = {
          cwd,
          signal,
          sessionId,
          env,
        };
        result = await tools.execute(call.name, toolInput, toolCtx);
      }

      if (call.name === "ExitPlanMode") {
        permissions.setMode("default" as PermissionMode);
      }

      if (debug) {
        console.error(`[debug] Tool ${call.name}: ${result.isError ? "ERROR" : "OK"} (${result.content.length} chars)`);
      }

      // Fire PostToolUse or PostToolUseFailure
      if (hooks) {
        if (result.isError) {
          await hooks.fire(
            "PostToolUseFailure",
            {
              event: "PostToolUseFailure",
              hook_event_name: "PostToolUseFailure",
              tool_name: call.name,
              tool_result: result.content,
              tool_error: true,
              session_id: sessionId,
            },
            call.id,
            { signal },
          );
        } else {
          const postResult = await hooks.fire(
            "PostToolUse",
            {
              event: "PostToolUse",
              hook_event_name: "PostToolUse",
              tool_name: call.name,
              tool_result: result.content,
              session_id: sessionId,
            },
            call.id,
            { signal },
          );
          // Append additionalContext if provided
          if (postResult?.additionalContext) {
            result.content += `\n${postResult.additionalContext}`;
          }
        }
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: result.content,
        is_error: result.isError,
      });
    }

    // Add tool results as user message
    messages.push({ role: "user", content: toolResults });

    // Log tool results to session
    if (sessionLogger) {
      sessionLogger("user", toolResults, null);
    }

    // Emit Claude-compatible user envelope containing tool_result blocks.
    yield {
      type: "user",
      message: {
        role: "user",
        content: toolResults,
      },
      parent_tool_use_id: null,
      isSynthetic: true,
      uuid: uuid(),
      session_id: sessionId,
    };
  }
}
