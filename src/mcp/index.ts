/**
 * MCP module — re-exports.
 */

export { McpClientManager } from "./client.ts";
export { createMcpServer, tool } from "./server.ts";
export type { McpToolDefinition } from "./server.ts";
export type {
  McpServerConfig,
  McpStdioConfig,
  McpSseConfig,
  McpHttpConfig,
  McpSdkConfig,
  McpServerStatus,
  McpToolInfo,
  McpResourceInfo,
} from "./types.ts";
