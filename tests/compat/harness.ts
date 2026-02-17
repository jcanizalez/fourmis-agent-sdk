import { mkdirSync } from "node:fs";
import { query as anthropicQuery } from "@anthropic-ai/claude-agent-sdk";
import { query as fourmisQuery } from "../../src/index.ts";
import type { AgentMessage, QueryOptions } from "../../src/index.ts";
import type {
  CompatSdk,
  CompatScenario,
  RunTrace,
  ScenarioContext,
  ScenarioRunConfig,
} from "./types.ts";

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
const DEFAULT_MAX_TURNS = 8;
const DEFAULT_MAX_BUDGET_USD = 0.5;

const ANTHROPIC_OPTION_KEYS = new Set<string>([
  "model",
  "cwd",
  "tools",
  "maxTurns",
  "maxBudgetUsd",
  "systemPrompt",
  "appendSystemPrompt",
  "allowedTools",
  "disallowedTools",
  "permissionPromptToolName",
  "permissionMode",
  "settingSources",
  "hooks",
  "mcpServers",
  "agents",
  "includePartialMessages",
  "thinking",
  "effort",
  "outputFormat",
  "memoryPath",
  "strictMcpConfig",
  "plugins",
  "skillPaths",
  "includeDefaultSkills",
  "signal",
  "env",
]);

type TraceCollectorState = {
  firstTextAtMs: number | null;
  toolUseNames: Map<string, string>;
};

function nowIso(): string {
  return new Date().toISOString();
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const text = (item as { text?: unknown }).text;
          if (typeof text === "string") return text;
          try {
            return JSON.stringify(item);
          } catch {
            return "[unserializable]";
          }
        }
        return asString(item);
      })
      .join("\n");
  }
  if (content && typeof content === "object") {
    const maybeText = (content as { text?: unknown }).text;
    if (typeof maybeText === "string") return maybeText;
    try {
      return JSON.stringify(content);
    } catch {
      return "[unserializable]";
    }
  }
  return asString(content);
}

function makeEmptyTrace(sdk: CompatSdk, scenarioId: string, runId: string): RunTrace {
  const startedAt = nowIso();
  return {
    sdk,
    scenarioId,
    runId,
    startedAt,
    finishedAt: startedAt,
    durationMs: 0,
    durationApiMs: 0,
    ttftMs: 0,
    turns: 0,
    costUsd: 0,
    stopReason: "unknown",
    errors: [],
    textOutput: "",
    toolCalls: [],
    toolResults: [],
    hookEvents: [],
    permissionDenials: [],
    streamEventCounts: {
      textDelta: 0,
      thinkingDelta: 0,
      partialAssistant: 0,
    },
  };
}

function markFirstText(state: TraceCollectorState, startMs: number): void {
  if (state.firstTextAtMs === null) {
    state.firstTextAtMs = performance.now() - startMs;
  }
}

function collectContentBlocks(
  trace: RunTrace,
  state: TraceCollectorState,
  startMs: number,
  content: unknown,
): void {
  if (!Array.isArray(content)) return;

  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const typed = block as { type?: unknown; text?: unknown; id?: unknown; name?: unknown; input?: unknown };
    if (typed.type === "text" && typeof typed.text === "string") {
      markFirstText(state, startMs);
      trace.textOutput += typed.text;
      continue;
    }
    if (typed.type === "tool_use") {
      const id = asString(typed.id);
      const name = asString(typed.name);
      trace.toolCalls.push({ id, name, input: typed.input });
      if (id) state.toolUseNames.set(id, name);
    }
  }
}

function collectMessage(
  trace: RunTrace,
  state: TraceCollectorState,
  startMs: number,
  msg: AgentMessage,
): void {
  if ((msg as { type?: unknown }).type === "assistant_partial") {
    trace.streamEventCounts.partialAssistant += 1;
    const content = (msg as { message?: { content?: unknown } }).message?.content;
    collectContentBlocks(trace, state, startMs, content);
    return;
  }

  switch (msg.type) {
    case "assistant": {
      const content = (msg as { message?: { content?: unknown } }).message?.content;
      collectContentBlocks(trace, state, startMs, content);
      break;
    }
    case "stream_event": {
      const event = (msg as { event?: { type?: unknown } }).event;
      if (!event || typeof event !== "object") break;
      const eventType = asString((event as { type?: unknown }).type);
      if (eventType === "text_delta") {
        trace.streamEventCounts.textDelta += 1;
        markFirstText(state, startMs);
      }
      if (eventType === "thinking_delta") {
        trace.streamEventCounts.thinkingDelta += 1;
      }
      break;
    }
    case "user": {
      const content = (msg as { message?: { content?: unknown } }).message?.content;
      if (!Array.isArray(content)) break;

      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const typed = block as {
          type?: unknown;
          tool_use_id?: unknown;
          is_error?: unknown;
          content?: unknown;
        };
        if (typed.type !== "tool_result") continue;

        const toolUseId = asString(typed.tool_use_id);
        trace.toolResults.push({
          toolUseId,
          name: state.toolUseNames.get(toolUseId) ?? toolUseId,
          isError: Boolean(typed.is_error),
          content: contentToText(typed.content),
        });
      }
      break;
    }
    case "result": {
      const result = msg as {
        subtype?: unknown;
        num_turns?: unknown;
        total_cost_usd?: unknown;
        duration_ms?: unknown;
        duration_api_ms?: unknown;
        errors?: unknown;
        permission_denials?: unknown;
        structured_output?: unknown;
      };
      trace.rawResultSubtype = asString(result.subtype);
      trace.stopReason = trace.rawResultSubtype || "unknown";
      trace.turns = Number(result.num_turns ?? trace.turns) || 0;
      trace.costUsd = Number(result.total_cost_usd ?? trace.costUsd) || 0;
      trace.durationMs = Number(result.duration_ms ?? trace.durationMs) || 0;
      trace.durationApiMs = Number(result.duration_api_ms ?? trace.durationApiMs) || 0;
      if (Array.isArray(result.errors)) {
        trace.errors = result.errors.map((entry) => asString(entry)).filter(Boolean);
      }
      if (Array.isArray(result.permission_denials)) {
        trace.permissionDenials = result.permission_denials
          .map((entry) => {
            if (!entry || typeof entry !== "object") return "";
            return asString((entry as { tool_name?: unknown }).tool_name);
          })
          .filter(Boolean);
      }
      if (result.structured_output !== undefined) {
        trace.structuredOutput = result.structured_output;
      }
      break;
    }
    default:
      break;
  }
}

function buildFourmisOptions(config: ScenarioRunConfig): QueryOptions {
  const options: QueryOptions = {
    provider: "anthropic",
    model: config.model ?? DEFAULT_MODEL,
    cwd: config.cwd,
    tools: config.tools,
    maxTurns: config.maxTurns ?? DEFAULT_MAX_TURNS,
    maxBudgetUsd: config.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    ...(config.sharedOptions ?? {}),
    ...(config.fourmisOptions ?? {}),
  };

  if (options.permissionMode === "bypassPermissions" && options.allowDangerouslySkipPermissions !== true) {
    options.allowDangerouslySkipPermissions = true;
  }

  return options;
}

function buildAnthropicOptions(config: ScenarioRunConfig): Record<string, unknown> {
  const options: Record<string, unknown> = {
    model: config.model ?? DEFAULT_MODEL,
    executable: "node",
    cwd: config.cwd,
    tools: config.tools,
    maxTurns: config.maxTurns ?? DEFAULT_MAX_TURNS,
    maxBudgetUsd: config.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD,
    permissionMode: "acceptEdits",
  };

  const fromShared = config.sharedOptions ?? {};
  for (const [key, value] of Object.entries(fromShared)) {
    if (!ANTHROPIC_OPTION_KEYS.has(key)) continue;
    options[key] = value;
  }

  if (config.anthropicOptions) {
    for (const [key, value] of Object.entries(config.anthropicOptions)) {
      options[key] = value;
    }
  }

  return options;
}

function ensureClaudeConfigDir(repoRoot: string): void {
  if (process.env.CLAUDE_CONFIG_DIR) return;
  const configDir = `${repoRoot}/.tmp-claude-config`;
  mkdirSync(configDir, { recursive: true });
  process.env.CLAUDE_CONFIG_DIR = configDir;
}

async function runFourmis(
  scenario: CompatScenario,
  config: ScenarioRunConfig,
  hooks: Record<string, unknown> | undefined,
  mcpServers: Record<string, unknown> | undefined,
  ctx: ScenarioContext,
): Promise<RunTrace> {
  const trace = makeEmptyTrace("fourmis", scenario.id, ctx.runId);
  const startMs = performance.now();
  const state: TraceCollectorState = {
    firstTextAtMs: null,
    toolUseNames: new Map<string, string>(),
  };

  try {
    const options = buildFourmisOptions(config);
    if (hooks) {
      options.hooks = hooks as QueryOptions["hooks"];
    }
    if (mcpServers) {
      options.mcpServers = mcpServers as QueryOptions["mcpServers"];
    }

    const conversation = fourmisQuery({
      prompt: config.prompt,
      options,
    });

    for await (const msg of conversation) {
      collectMessage(trace, state, startMs, msg);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : asString(error);
    trace.errors.push(message);
    trace.stopReason = "exception";
  }

  const wallMs = Math.round(performance.now() - startMs);
  trace.durationMs = trace.durationMs > 0 ? trace.durationMs : wallMs;
  trace.ttftMs = state.firstTextAtMs === null ? trace.durationMs : Math.round(state.firstTextAtMs);
  trace.finishedAt = nowIso();
  return trace;
}

async function runAnthropic(
  scenario: CompatScenario,
  config: ScenarioRunConfig,
  hooks: Record<string, unknown> | undefined,
  mcpServers: Record<string, unknown> | undefined,
  ctx: ScenarioContext,
): Promise<RunTrace> {
  const trace = makeEmptyTrace("anthropic", scenario.id, ctx.runId);
  const startMs = performance.now();
  const state: TraceCollectorState = {
    firstTextAtMs: null,
    toolUseNames: new Map<string, string>(),
  };

  const savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  ensureClaudeConfigDir(ctx.repoRoot);

  try {
    const options = buildAnthropicOptions(config);
    if (hooks) options.hooks = hooks;
    if (mcpServers) options.mcpServers = mcpServers;

    const conversation = anthropicQuery({
      prompt: config.prompt,
      options: options as any,
    });

    for await (const msg of conversation) {
      collectMessage(trace, state, startMs, msg as AgentMessage);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : asString(error);
    trace.errors.push(message);
    trace.stopReason = "exception";
  } finally {
    if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
  }

  const wallMs = Math.round(performance.now() - startMs);
  trace.durationMs = trace.durationMs > 0 ? trace.durationMs : wallMs;
  trace.ttftMs = state.firstTextAtMs === null ? trace.durationMs : Math.round(state.firstTextAtMs);
  trace.finishedAt = nowIso();
  return trace;
}

async function maybeCleanup(cleanup?: (() => Promise<void> | void) | undefined): Promise<void> {
  if (!cleanup) return;
  await cleanup();
}

export async function runScenarioPair(
  scenario: CompatScenario,
  ctx: ScenarioContext,
): Promise<{ fourmis: RunTrace; anthropic: RunTrace }> {
  const config = await scenario.buildRunConfig(ctx);

  const serverBundle = config.buildMcpServers?.();
  const fourmisHookEvents: string[] = [];
  const anthropicHookEvents: string[] = [];

  const fourmisHooks = config.buildHooks?.("fourmis", fourmisHookEvents) as Record<string, unknown> | undefined;
  const anthropicHooks = config.buildHooks?.("anthropic", anthropicHookEvents) as Record<string, unknown> | undefined;

  try {
    const fourmis = await runFourmis(
      scenario,
      config,
      fourmisHooks,
      serverBundle?.fourmis,
      ctx,
    );
    fourmis.hookEvents = fourmisHookEvents;

    const anthropic = await runAnthropic(
      scenario,
      config,
      anthropicHooks,
      serverBundle?.anthropic,
      ctx,
    );
    anthropic.hookEvents = anthropicHookEvents;

    return { fourmis, anthropic };
  } finally {
    await maybeCleanup(serverBundle?.cleanup);
    await maybeCleanup(config.cleanup);
  }
}
