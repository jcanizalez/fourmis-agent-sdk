/**
 * MCP server configuration and status types.
 */

/** Minimal interface for an MCP server that can connect to a transport */
export interface McpServerInstance {
  connect(transport: unknown): Promise<void>;
}

export type McpStdioConfig = {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type McpSseConfig = {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
};

export type McpHttpConfig = {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  /** Custom prefix for tool names. If empty string, no prefix is added. Defaults to server name. */
  toolPrefix?: string;
};

export type McpClaudeAIProxyConfig = {
  type: "claudeai-proxy";
  url: string;
  id: string;
};

export type McpSdkConfig = {
  type: "sdk";
  name: string;
  instance: McpServerInstance;
};

export type McpServerConfig = McpStdioConfig | McpSseConfig | McpHttpConfig | McpSdkConfig;

export type McpServerConfigForProcessTransport =
  | McpStdioConfig
  | McpSseConfig
  | McpHttpConfig
  | Omit<McpSdkConfig, "instance">;

export type McpServerStatusConfig = McpServerConfigForProcessTransport | McpClaudeAIProxyConfig;

export type McpToolInfo = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: {
    readOnly?: boolean;
    destructive?: boolean;
    openWorld?: boolean;
  };
};

export type McpResourceInfo = {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
};

export type McpServerStatus = {
  name: string;
  status: "connected" | "failed" | "needs-auth" | "pending" | "disabled";
  serverInfo?: { name: string; version: string };
  config?: McpServerStatusConfig;
  scope?: string;
  tools?: McpToolInfo[];
  error?: string;
};
