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
};

export type McpSdkConfig = {
  type: "sdk";
  name: string;
  instance: McpServerInstance;
};

export type McpServerConfig = McpStdioConfig | McpSseConfig | McpHttpConfig | McpSdkConfig;

export type McpToolInfo = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type McpResourceInfo = {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
};

export type McpServerStatus = {
  name: string;
  status: "connected" | "failed" | "pending" | "disabled";
  tools?: McpToolInfo[];
  error?: string;
};
