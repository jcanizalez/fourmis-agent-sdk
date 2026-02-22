/**
 * Public query() function — the main entry point.
 */

import type { QueryOptions, Query, PermissionsConfig, SdkPluginConfig } from "./types.ts";
import { uuid } from "./types.ts";
import { getProvider } from "./providers/registry.ts";
import { resolveToolNames, buildToolRegistry } from "./tools/index.ts";
import { PermissionManager } from "./permissions.ts";
import { SettingsManager } from "./settings.ts";
import { buildSystemPrompt } from "./utils/system-prompt.ts";
import { agentLoop } from "./agent-loop.ts";
import { createQuery, type QueryControlHandlers } from "./query.ts";
import { HookManager } from "./hooks.ts";
import { McpClientManager } from "./mcp/client.ts";
import { createTaskTool, createTaskOutputTool, createTaskStopTool } from "./agents/tools.ts";
import { createListMcpResourcesTool, createReadMcpResourceTool } from "./tools/mcp-resources.ts";
import { TaskManager } from "./agents/task-manager.ts";
import { findLatestSession, loadSessionMessages, createSessionLogger } from "./utils/session-store.ts";
import type { NormalizedMessage } from "./providers/types.ts";
import { createNativeMemoryTool, createMemoryTool } from "./memory/index.ts";
import type { NativeMemoryTool } from "./memory/index.ts";
import { loadSkills, loadSkillsFromDir } from "./skills/index.ts";
import type { Skill } from "./skills/index.ts";
import { loadPluginComponents } from "./plugins.ts";

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
const DEFAULT_MAX_TURNS = 10;
const DEFAULT_MAX_BUDGET_USD = 5;

/**
 * Start an agent conversation.
 *
 * Returns a Query (AsyncGenerator<AgentMessage>) that streams events
 * as the agent thinks, calls tools, and produces results.
 *
 * @example
 * ```ts
 * const conversation = query({
 *   prompt: "Read package.json and tell me the project name",
 *   options: {
 *     provider: "anthropic",
 *     model: "claude-sonnet-4-5-20250929",
 *     cwd: "/my/project",
 *     tools: { type: "preset", preset: "claude_code" },
 *     maxTurns: 5,
 *   },
 * });
 *
 * for await (const msg of conversation) {
 *   if (msg.type === "assistant") {
 *     for (const block of msg.message.content) {
 *       if (block.type === "text") process.stdout.write(block.text);
 *     }
 *   }
 *   if (msg.type === "result") console.log(`\nDone: $${msg.total_cost_usd}`);
 * }
 * ```
 */
export function query(params: {
  prompt: string | AsyncIterable<import("./types.ts").SDKUserMessage>;
  options?: QueryOptions;
}): Query {
  const { options = {} } = params;
  const prompt = params.prompt;

  if (typeof prompt !== "string") {
    throw new Error(
      "query({ prompt: AsyncIterable }) is not supported in single-prompt mode yet. Use Query.streamInput() in a streaming session.",
    );
  }

  // Resolve provider
  const providerName = options.provider ?? "anthropic";
  const provider = getProvider(providerName, {
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
  });

  // Resolve model
  const model = options.model ?? DEFAULT_MODEL;
  const fallbackModel = options.fallbackModel;
  const modelState = { current: model };

  const resolvedThinkingBudget = (() => {
    if (options.thinking) {
      switch (options.thinking.type) {
        case "disabled":
          return 0;
        case "enabled":
          return options.thinking.budgetTokens;
        case "adaptive":
          return undefined;
      }
    }
    return options.maxThinkingTokens;
  })();
  const maxThinkingTokensState = { current: resolvedThinkingBudget };

  if (options.permissionMode === "bypassPermissions" && options.allowDangerouslySkipPermissions !== true) {
    throw new Error(
      'permissionMode "bypassPermissions" requires allowDangerouslySkipPermissions: true',
    );
  }

  // Resolve tools
  const toolNames = resolveToolNames(options.tools);
  const registry = buildToolRegistry(
    toolNames,
    undefined, // allowedTools is for permissions, not filtering
    options.disallowedTools,
  );

  // Skills — load from default locations + explicit paths
  let skills: Skill[] = [];
  {
    const skillsResult = loadSkills({
      cwd: options.cwd,
      skillPaths: options.skillPaths,
      includeDefaults: options.includeDefaultSkills !== false,
    });
    skills = skillsResult.skills;

    // Log diagnostics in debug mode
    if (options.debug && skillsResult.diagnostics.length > 0) {
      for (const d of skillsResult.diagnostics) {
        console.warn(`[skills] ${d.type}: ${d.message} (${d.path})`);
      }
    }
  }

  // Plugins — load skills and MCP servers from plugin directories
  const pluginComponents = loadPluginComponents(options.plugins, options.debug);
  if (pluginComponents.skills.length > 0) {
    // Merge plugin skills (avoid name collisions — plugin skills take lower priority)
    const existingNames = new Set(skills.map(s => s.name));
    for (const skill of pluginComponents.skills) {
      if (!existingNames.has(skill.name)) {
        skills.push(skill);
        existingNames.add(skill.name);
      } else if (options.debug) {
        console.warn(`[plugins] skill "${skill.name}" already loaded, skipping plugin version`);
      }
    }
  }
  if (options.debug && pluginComponents.skillDiagnostics.length > 0) {
    for (const d of pluginComponents.skillDiagnostics) {
      console.warn(`[plugins/skills] ${d.type}: ${d.message} (${d.path})`);
    }
  }

  // Merge plugin MCP servers into options.mcpServers
  if (Object.keys(pluginComponents.mcpServers).length > 0) {
    options.mcpServers = {
      ...(options.mcpServers ?? {}),
      ...pluginComponents.mcpServers,
    };
  }

  // Build system prompt
  const systemPrompt = (() => {
    if (typeof options.systemPrompt === "string") {
      return options.systemPrompt;
    }

    const appendedPrompt = typeof options.systemPrompt === "object"
      ? [options.systemPrompt.append, options.appendSystemPrompt].filter(Boolean).join("\n\n")
      : options.appendSystemPrompt;

    return buildSystemPrompt({
      tools: registry.list(),
      cwd: options.cwd,
      additionalDirectories: options.additionalDirectories,
      loadProjectInstructions: Array.isArray(options.settingSources) && options.settingSources.includes("project"),
      customPrompt: appendedPrompt,
      skills,
    });
  })();

  // Settings manager (file-based permissions)
  let settingsManager: SettingsManager | undefined;
  let mergedPermissions = options.permissions;

  if (options.settingSources && options.settingSources.length > 0) {
    const cwd = options.cwd ?? process.cwd();
    settingsManager = new SettingsManager(cwd);
    const filePermissions = settingsManager.loadPermissions(options.settingSources);

    // Merge: file permissions as base, explicit options override
    if (filePermissions.allow || filePermissions.deny || mergedPermissions) {
      const mergedAllow = [
        ...(filePermissions.allow ?? []),
        ...(mergedPermissions?.allow ?? []),
      ];
      const mergedDeny = [
        ...(filePermissions.deny ?? []),
        ...(mergedPermissions?.deny ?? []),
      ];
      mergedPermissions = {} as PermissionsConfig;
      if (mergedAllow.length > 0) mergedPermissions.allow = mergedAllow;
      if (mergedDeny.length > 0) mergedPermissions.deny = mergedDeny;
    }
  }

  // Merge allowedTools into permission allow rules (pre-approved tools)
  if (options.allowedTools && options.allowedTools.length > 0) {
    if (!mergedPermissions) mergedPermissions = {} as PermissionsConfig;
    mergedPermissions.allow = [
      ...(mergedPermissions.allow ?? []),
      ...options.allowedTools,
    ];
  }

  // Permission manager
  const permissions = new PermissionManager(
    options.permissionMode ?? "default",
    options.canUseTool,
    mergedPermissions,
    settingsManager,
  );

  // Working directory
  const cwd = options.cwd ?? process.cwd();

  // Session — resolve ID and load previous messages
  let sessionId = options.sessionId ?? uuid();
  let previousMessages: NormalizedMessage[] | undefined;

  if (options.continue) {
    // Continue most recent session in this cwd
    const latestId = findLatestSession(cwd);
    if (latestId) {
      previousMessages = loadSessionMessages(cwd, latestId);
      if (options.forkSession) {
        // Fork: keep old messages as context but use a new session ID
        sessionId = uuid();
      } else {
        sessionId = latestId;
      }
    }
  } else if (options.resume) {
    // Resume a specific session by ID
    previousMessages = loadSessionMessages(cwd, options.resume, options.resumeSessionAt);
    if (options.forkSession) {
      sessionId = uuid();
    } else {
      sessionId = options.resume;
    }
  }

  // Session logger — persists messages to JSONL
  const persistSession = options.persistSession !== false;
  const sessionLogger = persistSession ? createSessionLogger(cwd, sessionId, model) : undefined;

  // Abort controller
  const abortController = options.abortController ?? new AbortController();
  if (options.signal) {
    options.signal.addEventListener("abort", () => abortController.abort(), { once: true });
  }

  // Hooks
  const hookManager = options.hooks ? new HookManager(options.hooks) : undefined;

  // MCP
  const mcpClient = options.mcpServers && Object.keys(options.mcpServers).length > 0
    ? new McpClientManager(options.mcpServers)
    : undefined;
  const syncMcpTools = () => {
    if (!mcpClient) return;
    registry.clearByPrefix("mcp__");
    for (const tool of mcpClient.getTools()) {
      registry.register(tool);
    }
    registry.register(createListMcpResourcesTool(mcpClient));
    registry.register(createReadMcpResourceTool(mcpClient));
  };

  // Subagents
  if (options.agents && Object.keys(options.agents).length > 0) {
    const taskManager = new TaskManager();
    const agentCtx = {
      agents: options.agents,
      parentProvider: provider,
      parentModel: modelState.current,
      parentPermissions: permissions,
      parentHooks: hookManager,
      parentCwd: cwd,
      parentEnv: options.env,
      parentDebug: options.debug,
      taskManager,
    };
    registry.register(createTaskTool(agentCtx));
    registry.register(createTaskOutputTool(taskManager));
    registry.register(createTaskStopTool(taskManager));
  }

  // Memory — provider-agnostic setup
  let nativeMemoryTool: NativeMemoryTool | undefined;
  if (options.memoryPath) {
    const memoryConfig = { path: options.memoryPath };
    if (providerName === "anthropic") {
      // Anthropic: use native memory_20250818 tool type (handled by provider)
      nativeMemoryTool = createNativeMemoryTool(memoryConfig);
    } else {
      // OpenAI/Gemini: register as a standard function tool
      registry.register(createMemoryTool(memoryConfig));
    }
  }

  // Create agent loop generator
  const generator = agentLoop(prompt, {
    provider,
    model,
    modelState,
    maxThinkingTokensState,
    fallbackModel,
    thinking: options.thinking,
    effort: options.effort,
    outputFormat: options.outputFormat,
    systemPrompt,
    tools: registry,
    permissions,
    cwd,
    sessionId,
    maxTurns: options.maxTurns ?? DEFAULT_MAX_TURNS,
    maxBudgetUsd: options.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD,
    includePartialMessages: options.includePartialMessages ?? false,
    signal: abortController.signal,
    env: options.env,
    debug: options.debug,
    hooks: hookManager,
    mcpClient,
    previousMessages,
    sessionLogger,
    nativeMemoryTool,
    initMeta: {
      betas: options.betas,
      outputStyle: "default",
      slashCommands: skills.map((s) => `/${s.name}`),
      skills: skills.map((s) => s.name),
      plugins: options.plugins,
      agents: options.agents ? Object.keys(options.agents) : undefined,
    },
  });

  const controls: QueryControlHandlers = {
    async setPermissionMode(mode) {
      permissions.setMode(mode);
    },
    async setModel(nextModel) {
      modelState.current = nextModel ?? model;
    },
    async setMaxThinkingTokens(maxThinkingTokens) {
      maxThinkingTokensState.current = maxThinkingTokens ?? undefined;
    },
    async initializationResult() {
      const models = provider.listModels ? await provider.listModels() : [];
      return {
        commands: skills.map((s) => ({
          name: s.name,
          description: s.description,
          argumentHint: "",
        })),
        output_style: "default",
        available_output_styles: ["default"],
        models,
        account: {},
      };
    },
    async supportedCommands() {
      return skills.map((s) => ({
        name: s.name,
        description: s.description,
        argumentHint: "",
      }));
    },
    async supportedModels() {
      return provider.listModels ? await provider.listModels() : [];
    },
    async mcpServerStatus() {
      return mcpClient ? mcpClient.status() : [];
    },
    async accountInfo() {
      return {
        tokenSource: options.apiKey ? "api-key" : "runtime",
        apiKeySource: options.apiKey ? "explicit" : "env_or_oauth",
      };
    },
    async rewindFiles(_userMessageId, _options) {
      if (!options.enableFileCheckpointing) {
        return {
          canRewind: false,
          error: "File checkpointing is disabled. Set enableFileCheckpointing: true.",
        };
      }
      return {
        canRewind: false,
        error: "File checkpoint rewind is not implemented in fourmis-agent-sdk yet.",
      };
    },
    async reconnectMcpServer(serverName) {
      if (!mcpClient) throw new Error("No MCP servers are configured for this query.");
      await mcpClient.reconnectServer(serverName);
      syncMcpTools();
    },
    async toggleMcpServer(serverName, enabled) {
      if (!mcpClient) throw new Error("No MCP servers are configured for this query.");
      await mcpClient.toggleServer(serverName, enabled);
      syncMcpTools();
    },
    async setMcpServers(servers) {
      if (!mcpClient) throw new Error("No MCP client is available for this query.");
      const result = await mcpClient.setServers(servers);
      syncMcpTools();
      return result;
    },
    async streamInput() {
      throw new Error("Query.streamInput is not implemented for single-prompt query mode.");
    },
  };

  return createQuery(generator, abortController, controls);
}
