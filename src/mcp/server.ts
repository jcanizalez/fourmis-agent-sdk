/**
 * In-process MCP server factory — create MCP servers with tool definitions.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpSdkConfig } from "./types.ts";

export type McpToolDefinition = {
  name: string;
  description: string;
  schema: Record<string, z.ZodTypeAny>;
  handler: (input: any) => Promise<string>;
};

/**
 * Define an MCP tool with a Zod schema.
 */
export function tool(
  name: string,
  description: string,
  schema: Record<string, z.ZodTypeAny>,
  handler: (input: any) => Promise<string>,
): McpToolDefinition {
  return { name, description, schema, handler };
}

/**
 * Create an in-process MCP server from tool definitions.
 * Returns an McpSdkConfig ready to pass to McpClientManager.
 */
export function createMcpServer(opts: {
  name: string;
  version?: string;
  tools?: McpToolDefinition[];
}): McpSdkConfig {
  const server = new McpServer({
    name: opts.name,
    version: opts.version ?? "1.0.0",
  });

  if (opts.tools) {
    for (const t of opts.tools) {
      server.tool(
        t.name,
        t.description,
        t.schema,
        async (input: any) => {
          const text = await t.handler(input);
          return { content: [{ type: "text" as const, text }] };
        },
      );
    }
  }

  return {
    type: "sdk",
    name: opts.name,
    instance: server as any,
  };
}
