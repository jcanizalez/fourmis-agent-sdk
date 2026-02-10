# MCP Support: fourmis-agents

Full Model Context Protocol support matching the Anthropic Agent SDK's capabilities.

---

## Overview

fourmis-agents supports MCP as both a **client** (connecting to external MCP servers to use their tools) and a **server** (exposing custom tools via in-process MCP servers).

```
┌──────────────────────────────────────────────┐
│  fourmis-agents                              │
│                                              │
│  Agent Loop                                  │
│    ├── Built-in tools (Bash, Read, etc.)     │
│    ├── MCP Client ──→ External MCP Servers   │
│    │     ├── stdio transport                 │
│    │     ├── SSE transport                   │
│    │     └── HTTP transport                  │
│    └── SDK MCP Server (in-process tools)     │
└──────────────────────────────────────────────┘
```

---

## 1. MCP Server Configuration

Four transport types, matching the Anthropic Agent SDK:

### Stdio (default, most common)

Spawns a subprocess that communicates via stdin/stdout JSON-RPC.

```ts
mcpServers: {
  "my-tools": {
    // type defaults to "stdio" when command is present
    command: "node",
    args: ["./my-mcp-server.js"],
    env: { MY_VAR: "value" },
  },
}
```

### SSE (Server-Sent Events)

Connects to a running SSE-based MCP server.

```ts
mcpServers: {
  "remote-tools": {
    type: "sse",
    url: "https://my-server.com/mcp/sse",
    headers: { "Authorization": "Bearer token" },
  },
}
```

### HTTP (Streamable HTTP)

Connects to a stateless HTTP MCP server.

```ts
mcpServers: {
  "http-tools": {
    type: "http",
    url: "https://my-server.com/mcp",
    headers: { "Authorization": "Bearer token" },
  },
}
```

### SDK (In-Process)

Tools defined in your code, no network or subprocess overhead.

```ts
import { createMcpServer, tool } from "fourmis-agents";
import { z } from "zod";

const myServer = createMcpServer({
  name: "my-tools",
  tools: [
    tool(
      "get_weather",
      "Get current weather for a city",
      { city: z.string(), unit: z.enum(["celsius", "fahrenheit"]).optional() },
      async ({ city, unit }) => ({
        content: [{ type: "text", text: `Weather in ${city}: 22°${unit === "fahrenheit" ? "F" : "C"}` }],
      }),
      { annotations: { readOnlyHint: true, openWorldHint: true } },
    ),
  ],
});

// Pass to query
query({
  prompt: "What's the weather in Tokyo?",
  options: {
    mcpServers: { "my-tools": myServer },
  },
});
```

---

## 2. MCP Client

### Connection Lifecycle

```ts
class McpClientManager {
  // Connect to all configured servers at init
  async connectAll(configs: Record<string, McpServerConfig>): Promise<void>;

  // Get status of all servers
  status(): McpServerStatus[];

  // Dynamic management (mid-session)
  async reconnect(name: string): Promise<void>;
  async toggle(name: string, enabled: boolean): Promise<void>;
  async setServers(configs: Record<string, McpServerConfig>): Promise<McpSetResult>;

  // Tool discovery
  listTools(): McpToolInfo[];
  listResources(server?: string): McpResource[];

  // Tool execution
  async callTool(server: string, tool: string, input: unknown): Promise<ToolResult>;
  async readResource(server: string, uri: string): Promise<string>;

  // Cleanup
  async closeAll(): Promise<void>;
}

type McpServerStatus = {
  name: string;
  status: "connected" | "failed" | "pending" | "disabled";
  tools: string[];
  error?: string;
};
```

### Tool Namespacing

MCP tools are namespaced by server to avoid conflicts:

```
server: "javiers-mac-mini"
tool: "peekaboo__see"
→ agent sees: "mcp__javiers-mac-mini__peekaboo__see"
```

This matches how fourmis already handles MCP tool naming (via `mcpToolName()` in lib.ts).

### Health Probing

Same pattern as fourmis' existing health probe:

```ts
async function probeServer(name: string, config: McpServerConfig): Promise<McpServerStatus> {
  // For HTTP/SSE: fetch health endpoint with timeout
  // For stdio: spawn process, send initialize request
  // For SDK: always connected
}
```

---

## 3. In-Process MCP Server

### `createMcpServer()`

```ts
function createMcpServer(options: {
  name: string;
  version?: string;
  tools?: McpToolDefinition[];
}): McpSdkConfig;
```

Creates an in-process MCP server. No subprocess, no network — tools execute directly in the same process.

### `tool()` Helper

```ts
function tool<Schema extends ZodRawShape>(
  name: string,
  description: string,
  inputSchema: Schema,
  handler: (args: z.infer<z.ZodObject<Schema>>, extra: unknown) => Promise<CallToolResult>,
  extras?: { annotations?: ToolAnnotations },
): McpToolDefinition;
```

Define tools with Zod schemas for type-safe input validation.

**Zod 4 compatibility:** Uses `z.toJsonSchema()` to convert Zod schemas to JSON Schema for the MCP protocol.

### Tool Annotations

```ts
type ToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;           // Tool doesn't modify state
  destructiveHint?: boolean;         // Tool may irreversibly modify state
  idempotentHint?: boolean;          // Repeated calls with same args have same effect
  openWorldHint?: boolean;           // Tool interacts with external entities
};
```

---

## 4. MCP Resources

### Listing Resources

```ts
// List resources from all connected MCP servers
const resources = mcpClient.listResources();
// [{ server: "my-server", uri: "file:///path", name: "...", mimeType: "..." }]

// Filter by server
const resources = mcpClient.listResources("my-server");
```

### Reading Resources

```ts
const content = await mcpClient.readResource("my-server", "file:///path/to/doc.md");
```

### Agent Tools for Resources

The `ListMcpResources` and `ReadMcpResource` built-in tools expose this to the agent:

```ts
// LLM can call:
{ tool: "ListMcpResources", input: { server: "my-server" } }
{ tool: "ReadMcpResource", input: { server: "my-server", uri: "file:///path" } }
```

---

## 5. Dynamic MCP Management

Mid-session, the agent or host application can modify MCP connections:

```ts
// Via Query control methods
await query.reconnectMcpServer("my-server");
await query.toggleMcpServer("my-server", false);

const result = await query.setMcpServers({
  "new-server": { type: "http", url: "https://new.com/mcp" },
});
// result: { added: ["new-server"], removed: [], errors: [] }

// Status check
const statuses = await query.mcpServerStatus();
```

---

## 6. Integration with fourmis

fourmis already has a robust MCP system (daemon proxy, device pairing, health probing). When using fourmis-agents as a library, MCP servers can be passed through:

```ts
// In fourmis' genericProvider:
const conversation = query({
  prompt: opts.prompt,
  options: {
    mcpServers: opts.mcpServers,  // Pass through fourmis' resolved MCP configs
    // fourmis handles: device pairing, daemon proxy, health probing
    // fourmis-agents handles: connecting, tool discovery, tool execution
  },
});
```

This is a clean separation:
- **fourmis** manages the MCP infrastructure (devices, proxy, auth tokens)
- **fourmis-agents** manages MCP client connections and tool routing

---

## 7. Implementation Dependencies

```json
{
  "@modelcontextprotocol/sdk": "^1.26.0"  // MCP protocol implementation
}
```

We reuse the same `@modelcontextprotocol/sdk` that fourmis already uses. It provides:
- `Client` class for connecting to servers
- `Server` class for creating servers
- Transport implementations (stdio, SSE, HTTP)
- JSON-RPC message types
- Tool/resource/prompt schemas
