/**
 * MCP client manager — connects to external MCP servers and wraps their tools.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ToolImplementation, ToolResult } from "../tools/registry.ts";
import type {
  McpServerConfig,
  McpServerStatus,
  McpToolInfo,
  McpResourceInfo,
} from "./types.ts";
import type { McpSetServersResult } from "../types.ts";

type ConnectedServer = {
  name: string;
  client: Client;
  tools: McpToolInfo[];
  status: McpServerStatus;
};

export class McpClientManager {
  private configs: Record<string, McpServerConfig>;
  private servers = new Map<string, ConnectedServer>();
  private disabled = new Set<string>();

  constructor(configs: Record<string, McpServerConfig>) {
    this.configs = { ...configs };
  }

  async connectAll(): Promise<void> {
    const entries = Object.entries(this.configs);
    await Promise.all(entries.map(([name, config]) => this.connectOne(name, config)));
  }

  private async connectOne(name: string, config: McpServerConfig): Promise<void> {
    if (this.disabled.has(name)) {
      this.servers.set(name, {
        name,
        client: null!,
        tools: [],
        status: {
          name,
          status: "disabled",
          config: this.toStatusConfig(config),
          scope: config.type === "sdk" ? "sdk" : "session",
        },
      });
      return;
    }

    try {
      const client = new Client({ name: `fourmis-${name}`, version: "1.0.0" });

      if (config.type === "sdk") {
        // In-process SDK server
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await config.instance.connect(serverTransport);
        await client.connect(clientTransport);
      } else if (config.type === "sse") {
        const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");
        const opts = config.headers
          ? {
              eventSourceInit: { headers: config.headers } as any,
              requestInit: { headers: config.headers },
            }
          : undefined;
        const transport = new SSEClientTransport(new URL(config.url), opts);
        await client.connect(transport);
      } else if (config.type === "http") {
        const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
        const requestInit = config.headers
          ? { headers: config.headers }
          : undefined;
        const transport = new StreamableHTTPClientTransport(new URL(config.url), { requestInit });
        await client.connect(transport);
      } else {
        // stdio (default)
        const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
        const stdioConfig = config as { command: string; args?: string[]; env?: Record<string, string> };
        const transport = new StdioClientTransport({
          command: stdioConfig.command,
          args: stdioConfig.args,
          env: stdioConfig.env,
        });
        await client.connect(transport);
      }

      // List tools from the server
      const toolsResult = await client.listTools();
      const tools: McpToolInfo[] = (toolsResult.tools ?? []).map((t: any) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown> | undefined,
        annotations: t.annotations
          ? {
              readOnly: t.annotations.readOnly,
              destructive: t.annotations.destructive,
              openWorld: t.annotations.openWorld,
            }
          : undefined,
      }));

      this.servers.set(name, {
        name,
        client,
        tools,
        status: {
          name,
          status: "connected",
          tools,
          serverInfo: { name, version: "1.0.0" },
          config: this.toStatusConfig(config),
          scope: config.type === "sdk" ? "sdk" : "session",
        },
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.servers.set(name, {
        name,
        client: null!,
        tools: [],
        status: {
          name,
          status: "failed",
          error,
          config: this.toStatusConfig(config),
          scope: config.type === "sdk" ? "sdk" : "session",
        },
      });
    }
  }

  private toStatusConfig(config: McpServerConfig): McpServerStatus["config"] {
    if (config.type === "sdk") {
      return { type: "sdk", name: config.name };
    }
    return config as McpServerStatus["config"];
  }

  /**
   * Get all MCP tools wrapped as ToolImplementation, namespaced as server__tool.
   */
  getTools(): ToolImplementation[] {
    const result: ToolImplementation[] = [];

    for (const [serverName, server] of this.servers) {
      if (server.status.status !== "connected") continue;

      for (const tool of server.tools) {
        const config = this.configs[serverName];
        const prefix = "toolPrefix" in config ? config.toolPrefix : serverName;
        const namespacedName = prefix === "" ? tool.name : `${prefix}__${tool.name}`;
        result.push({
          name: namespacedName,
          description: tool.description ?? `MCP tool ${tool.name} from ${serverName}`,
          inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
          execute: async (input: unknown) => {
            return this.callTool(serverName, tool.name, input);
          },
        });
      }
    }

    return result;
  }

  async callTool(serverName: string, toolName: string, input: unknown): Promise<ToolResult> {
    const server = this.servers.get(serverName);
    if (!server || server.status.status !== "connected") {
      return { content: `MCP server "${serverName}" is not connected`, isError: true };
    }

    try {
      const result = await server.client.callTool({
        name: toolName,
        arguments: (input ?? {}) as Record<string, unknown>,
      });

      // Extract text content from the MCP result
      const content = (result.content as Array<{ type: string; text?: string }>)
        ?.map((c: any) => c.text ?? "")
        .join("") ?? JSON.stringify(result);

      return {
        content,
        isError: result.isError === true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `MCP tool error: ${message}`, isError: true };
    }
  }

  async listResources(serverName?: string): Promise<(McpResourceInfo & { server: string })[]> {
    const result: (McpResourceInfo & { server: string })[] = [];

    const serversToQuery = serverName
      ? [this.servers.get(serverName)].filter(Boolean) as ConnectedServer[]
      : [...this.servers.values()];

    for (const server of serversToQuery) {
      if (server.status.status !== "connected") continue;
      try {
        const resources = await server.client.listResources();
        for (const r of resources.resources ?? []) {
          result.push({
            uri: r.uri,
            name: r.name,
            description: r.description,
            mimeType: r.mimeType,
            server: server.name,
          });
        }
      } catch {
        // Server doesn't support resources — skip
      }
    }

    return result;
  }

  async readResource(serverName: string, uri: string): Promise<string> {
    const server = this.servers.get(serverName);
    if (!server || server.status.status !== "connected") {
      throw new Error(`MCP server "${serverName}" is not connected`);
    }

    const result = await server.client.readResource({ uri });
    const contents = result.contents ?? [];
    return contents.map((c: any) => {
      if ("text" in c) return c.text;
      if ("blob" in c) return `[binary data: ${c.mimeType ?? "unknown"}]`;
      return "";
    }).join("");
  }

  status(): McpServerStatus[] {
    // Include pending for configs not yet connected
    const result: McpServerStatus[] = [];
    for (const [name, config] of Object.entries(this.configs)) {
      const server = this.servers.get(name);
      if (server) {
        result.push(server.status);
      } else if (this.disabled.has(name)) {
        result.push({
          name,
          status: "disabled",
          config: this.toStatusConfig(config),
          scope: config.type === "sdk" ? "sdk" : "session",
        });
      } else {
        result.push({
          name,
          status: "pending",
          config: this.toStatusConfig(config),
          scope: config.type === "sdk" ? "sdk" : "session",
        });
      }
    }
    return result;
  }

  async reconnectServer(serverName: string): Promise<void> {
    const config = this.configs[serverName];
    if (!config) {
      throw new Error(`MCP server "${serverName}" is not configured`);
    }
    await this.closeOne(serverName);
    await this.connectOne(serverName, config);
    const status = this.servers.get(serverName)?.status;
    if (!status || status.status !== "connected") {
      throw new Error(status?.error ?? `Failed to reconnect MCP server "${serverName}"`);
    }
  }

  async toggleServer(serverName: string, enabled: boolean): Promise<void> {
    const config = this.configs[serverName];
    if (!config) {
      throw new Error(`MCP server "${serverName}" is not configured`);
    }

    if (!enabled) {
      this.disabled.add(serverName);
      await this.closeOne(serverName);
      this.servers.set(serverName, {
        name: serverName,
        client: null!,
        tools: [],
        status: {
          name: serverName,
          status: "disabled",
          config: this.toStatusConfig(config),
          scope: config.type === "sdk" ? "sdk" : "session",
        },
      });
      return;
    }

    this.disabled.delete(serverName);
    await this.reconnectServer(serverName);
  }

  async setServers(servers: Record<string, McpServerConfig>): Promise<McpSetServersResult> {
    const prevNames = new Set(Object.keys(this.configs));
    const nextNames = new Set(Object.keys(servers));

    const added = [...nextNames].filter((n) => !prevNames.has(n));
    const removed = [...prevNames].filter((n) => !nextNames.has(n));
    const errors: Record<string, string> = {};

    for (const name of removed) {
      await this.closeOne(name);
      delete this.configs[name];
      this.disabled.delete(name);
      this.servers.delete(name);
    }

    for (const [name, config] of Object.entries(servers)) {
      const prev = this.configs[name];
      this.configs[name] = config;

      if (this.disabled.has(name)) continue;

      if (!prev || JSON.stringify(this.toStatusConfig(prev)) !== JSON.stringify(this.toStatusConfig(config))) {
        await this.closeOne(name);
        await this.connectOne(name, config);
      }

      const status = this.servers.get(name)?.status;
      if (!status || status.status === "failed") {
        errors[name] = status?.error ?? "Failed to connect";
      }
    }

    return { added, removed, errors };
  }

  private async closeOne(serverName: string): Promise<void> {
    const existing = this.servers.get(serverName);
    if (existing?.client) {
      try {
        await existing.client.close();
      } catch {
        // ignore
      }
    }
  }

  async closeAll(): Promise<void> {
    for (const [name] of this.servers) {
      await this.closeOne(name);
    }
    this.servers.clear();
  }
}
