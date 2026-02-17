/**
 * fourmis-agents — Multi-provider AI agent SDK
 *
 * Public API entry point.
 */

export { query } from "./api.ts";

// Types
export type {
  AgentMessage,
  TextContent,
  ToolUseContent,
  ToolResultContent,
  ContentBlock,
  ApiKeySource,
  SDKStatus,
  SDKSystemMessage,
  SDKStatusMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKUserMessageReplay,
  SDKStreamEvent,
  SDKPartialAssistantMessage,
  SDKToolProgressMessage,
  SDKToolUseSummaryMessage,
  SDKTaskNotificationMessage,
  SDKAuthStatusMessage,
  SDKCompactBoundaryMessage,
  SDKHookStartedMessage,
  SDKHookProgressMessage,
  SDKHookResponseMessage,
  SDKFilesPersistedEvent,
  SDKPermissionDenial,
  SDKResultSuccess,
  SDKResultError,
  SDKMessage,
  QueryOptions,
  Query,
  SlashCommand,
  AccountInfo,
  RewindFilesResult,
  McpSetServersResult,
  QueryInitializationResult,
  TokenUsage,
  ModelUsage,
  PermissionMode,
  PermissionBehavior,
  PermissionResult,
  PermissionRuleValue,
  PermissionUpdate,
  PermissionUpdateDestination,
  PermissionsConfig,
  CanUseTool,
  SettingSource,
} from "./types.ts";

// Settings
export { SettingsManager } from "./settings.ts";

// Provider types
export type {
  ProviderAdapter,
  ChatRequest,
  ChatChunk,
  ToolDefinition,
  NormalizedMessage,
  ProviderFeature,
  ModelInfo,
} from "./providers/types.ts";

// Tool types
export type { ToolImplementation, ToolResult, ToolContext } from "./tools/registry.ts";
export { ToolRegistry } from "./tools/registry.ts";
export { PRESETS } from "./tools/presets.ts";

// Provider registry
export { registerProvider, getProvider } from "./providers/registry.ts";

// Individual tools (for custom registries)
export { BashTool } from "./tools/bash.ts";
export { ReadTool } from "./tools/read.ts";
export { WriteTool } from "./tools/write.ts";
export { EditTool } from "./tools/edit.ts";
export { GlobTool } from "./tools/glob.ts";
export { GrepTool } from "./tools/grep.ts";
export { NotebookEditTool } from "./tools/notebook-edit.ts";
export { WebFetchTool } from "./tools/web-fetch.ts";
export { WebSearchTool } from "./tools/web-search.ts";
export { AskUserQuestionTool } from "./tools/ask-user-question.ts";
export { TodoWriteTool } from "./tools/todo-write.ts";
export { ConfigTool } from "./tools/config.ts";
export { ExitPlanModeTool } from "./tools/exit-plan-mode.ts";

// Hooks
export { HookManager, HOOK_EVENTS } from "./hooks.ts";
export type {
  HookEvent,
  HookCallback,
  HookCallbackMatcher,
  HookInput,
  SyncHookJSONOutput,
} from "./hooks.ts";

// MCP
export { McpClientManager } from "./mcp/client.ts";
export { createMcpServer, tool as mcpTool } from "./mcp/server.ts";
export type {
  McpServerConfig,
  McpStdioConfig,
  McpSseConfig,
  McpHttpConfig,
  McpSdkConfig,
  McpServerStatus,
} from "./mcp/types.ts";

// Subagents
export { TaskManager } from "./agents/task-manager.ts";
export type { AgentDefinition, BackgroundTask } from "./agents/types.ts";

// Skills
export { loadSkills, loadSkillsFromDir, formatSkillsForPrompt, parseFrontmatter, stripFrontmatter } from "./skills/index.ts";
export type { Skill, SkillFrontmatter, SkillDiagnostic, LoadSkillsResult, LoadSkillsFromDirOptions, LoadSkillsOptions, ParsedFrontmatter } from "./skills/index.ts";

// Memory
export { createMemoryHandler, createNativeMemoryTool, createMemoryTool } from "./memory/index.ts";
export type { MemoryConfig, NativeMemoryTool, MemoryCommand } from "./memory/index.ts";
