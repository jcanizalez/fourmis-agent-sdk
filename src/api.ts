/**
 * Public query() function — the main entry point.
 */

import type { QueryOptions, Query, PermissionsConfig } from "./types.ts";
import { uuid } from "./types.ts";
import { getProvider } from "./providers/registry.ts";
import { resolveToolNames, buildToolRegistry } from "./tools/index.ts";
import { PermissionManager } from "./permissions.ts";
import { SettingsManager } from "./settings.ts";
import { buildSystemPrompt } from "./utils/system-prompt.ts";
import { agentLoop } from "./agent-loop.ts";
import { createQuery } from "./query.ts";
import { HookManager } from "./hooks.ts";
import { McpClientManager } from "./mcp/client.ts";
import { createTaskTool, createTaskOutputTool, createTaskStopTool } from "./agents/tools.ts";
import { TaskManager } from "./agents/task-manager.ts";

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
 *     tools: "coding",
 *     maxTurns: 5,
 *   },
 * });
 *
 * for await (const msg of conversation) {
 *   if (msg.type === "text") process.stdout.write(msg.text);
 *   if (msg.type === "tool_use") console.log(`\n[tool] ${msg.name}`);
 *   if (msg.type === "result") console.log(`\nDone: $${msg.costUsd}`);
 * }
 * ```
 */
export function query(params: {
  prompt: string;
  options?: QueryOptions;
}): Query {
  const { prompt, options = {} } = params;

  // Resolve provider
  const providerName = options.provider ?? "anthropic";
  const provider = getProvider(providerName, {
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
  });

  // Resolve model
  const model = options.model ?? DEFAULT_MODEL;

  // Resolve tools
  const toolNames = resolveToolNames(options.tools);
  const registry = buildToolRegistry(
    toolNames,
    options.allowedTools,
    options.disallowedTools,
  );

  // Build system prompt
  const systemPrompt = options.systemPrompt ?? buildSystemPrompt({
    tools: registry.list(),
    cwd: options.cwd,
  });

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

  // Permission manager
  const permissions = new PermissionManager(
    options.permissionMode ?? "default",
    options.canUseTool,
    mergedPermissions,
    settingsManager,
  );

  // Working directory
  const cwd = options.cwd ?? process.cwd();

  // Session
  const sessionId = uuid();

  // Abort controller
  const abortController = new AbortController();
  if (options.signal) {
    options.signal.addEventListener("abort", () => abortController.abort(), { once: true });
  }

  // Hooks
  const hookManager = options.hooks ? new HookManager(options.hooks) : undefined;

  // MCP
  const mcpClient = options.mcpServers && Object.keys(options.mcpServers).length > 0
    ? new McpClientManager(options.mcpServers)
    : undefined;

  // Subagents
  if (options.agents && Object.keys(options.agents).length > 0) {
    const taskManager = new TaskManager();
    const agentCtx = {
      agents: options.agents,
      parentProvider: provider,
      parentModel: model,
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

  // Create agent loop generator
  const generator = agentLoop(prompt, {
    provider,
    model,
    systemPrompt,
    tools: registry,
    permissions,
    cwd,
    sessionId,
    maxTurns: options.maxTurns ?? DEFAULT_MAX_TURNS,
    maxBudgetUsd: options.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD,
    includeStreamEvents: options.includeStreamEvents ?? false,
    signal: abortController.signal,
    env: options.env,
    debug: options.debug,
    hooks: hookManager,
    mcpClient,
  });

  return createQuery(generator, abortController);
}
