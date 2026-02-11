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
