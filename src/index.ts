/**
 * fourmis-agents — Multi-provider AI agent SDK
 *
 * Public API entry point.
 */

export { query } from "./api.ts";

// Types
export type {
  AgentMessage,
  InitMessage,
  TextMessage,
  ToolUseMessage,
  ToolResultMessage,
  StreamMessage,
  ResultMessage,
  ErrorMessage,
  StatusMessage,
  QueryOptions,
  Query,
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

// Memory
export { createMemoryHandler, createNativeMemoryTool, createMemoryTool } from "./memory/index.ts";
export type { MemoryConfig, NativeMemoryTool, MemoryCommand } from "./memory/index.ts";
