/**
 * MCP resource tools — list and read resources from MCP servers.
 */

import type { ToolImplementation } from "./registry.ts";
import type { McpClientManager } from "../mcp/client.ts";

export function createListMcpResourcesTool(mcpClient: McpClientManager): ToolImplementation {
  return {
    name: "mcp__list_resources",
    description: "List available resources from MCP servers.",
    inputSchema: {
      type: "object",
      properties: {
        server: {
          type: "string",
          description: "Optional server name to filter by. If omitted, lists resources from all servers.",
        },
      },
    },
    async execute(input: unknown) {
      const { server } = (input ?? {}) as { server?: string };
      try {
        const resources = await mcpClient.listResources(server);
        if (resources.length === 0) {
          return { content: "No resources available." };
        }
        const lines = resources.map(
          (r) => `[${r.server}] ${r.uri} - ${r.name}${r.description ? `: ${r.description}` : ""}`,
        );
        return { content: lines.join("\n") };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: `Error listing resources: ${message}`, isError: true };
      }
    },
  };
}

export function createReadMcpResourceTool(mcpClient: McpClientManager): ToolImplementation {
  return {
    name: "mcp__read_resource",
    description: "Read a specific resource from an MCP server by URI.",
    inputSchema: {
      type: "object",
      properties: {
        server: {
          type: "string",
          description: "The MCP server name that hosts the resource.",
        },
        uri: {
          type: "string",
          description: "The resource URI to read.",
        },
      },
      required: ["server", "uri"],
    },
    async execute(input: unknown) {
      const { server, uri } = input as { server: string; uri: string };
      if (!server || !uri) {
        return { content: "Both 'server' and 'uri' are required.", isError: true };
      }
      try {
        const content = await mcpClient.readResource(server, uri);
        return { content };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: `Error reading resource: ${message}`, isError: true };
      }
    },
  };
}
