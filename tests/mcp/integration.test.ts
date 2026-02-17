import { test, expect, afterEach } from "bun:test";
import { z } from "zod";
import { agentLoop } from "../../src/agent-loop.ts";
import { ToolRegistry } from "../../src/tools/registry.ts";
import { PermissionManager } from "../../src/permissions.ts";
import { McpClientManager } from "../../src/mcp/client.ts";
import { tool, createMcpServer } from "../../src/mcp/server.ts";
import type { ProviderAdapter, ChatRequest, ChatChunk, ProviderFeature } from "../../src/providers/types.ts";
import type { AgentMessage, TokenUsage } from "../../src/types.ts";

type MockResponse = {
  text?: string;
  toolCalls?: { id: string; name: string; input: unknown }[];
};

function createMockProvider(responses: MockResponse[]): ProviderAdapter {
  let callIndex = 0;
  return {
    name: "mock",
    async *chat(_request: ChatRequest): AsyncGenerator<ChatChunk> {
      const response = responses[callIndex++];
      if (!response) {
        yield { type: "text_delta", text: "No more mock responses" };
        yield { type: "usage", usage: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } };
        yield { type: "done", stopReason: "end_turn" };
        return;
      }
      if (response.text) yield { type: "text_delta", text: response.text };
      if (response.toolCalls) {
        for (const call of response.toolCalls) {
          yield { type: "tool_call", id: call.id, name: call.name, input: call.input };
        }
      }
      yield { type: "usage", usage: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } };
      yield { type: "done", stopReason: response.toolCalls ? "tool_use" : "end_turn" };
    },
    calculateCost(_model: string, usage: TokenUsage) {
      return (usage.inputTokens + usage.outputTokens) * 0.00001;
    },
    getContextWindow() { return 200_000; },
    supportsFeature() { return true; },
  };
}

let mcpClient: McpClientManager | undefined;

afterEach(async () => {
  if (mcpClient) {
    await mcpClient.closeAll();
    mcpClient = undefined;
  }
});

test("agent loop with MCP server: tool call flows end-to-end", async () => {
  // Create MCP server with a calculator tool
  const addTool = tool(
    "add",
    "Adds two numbers",
    { a: z.number(), b: z.number() },
    async (input) => String(input.a + input.b),
  );

  const serverConfig = createMcpServer({ name: "calc", tools: [addTool] });
  mcpClient = new McpClientManager({ calc: serverConfig });

  // Mock provider calls the MCP tool
  const provider = createMockProvider([
    {
      toolCalls: [{ id: "c1", name: "calc__add", input: { a: 5, b: 3 } }],
    },
    { text: "The result is 8" },
  ]);

  const tools = new ToolRegistry();
  const permissions = new PermissionManager("bypassPermissions");

  const messages: AgentMessage[] = [];
  for await (const msg of agentLoop("Add 5 and 3", {
    provider,
    model: "test",
    systemPrompt: "test",
    tools,
    permissions,
    cwd: "/tmp",
    sessionId: "test",
    maxTurns: 10,
    maxBudgetUsd: 1,
    includePartialMessages: false,
    signal: new AbortController().signal,
    mcpClient,
  })) {
    messages.push(msg);
  }

  // Init should show the MCP tools
  const init = messages.find((m) => m.type === "system" && m.subtype === "init") as any;
  expect(init.tools).toContain("calc__add");
  // Resource tools should also be registered
  expect(init.tools).toContain("mcp__list_resources");
  expect(init.tools).toContain("mcp__read_resource");

  // Tool call should succeed
  const toolResult = messages
    .filter((m) => m.type === "user")
    .flatMap((m: any) => m.message.content)
    .find((c: any) => c.type === "tool_result") as any;
  expect(toolResult).toBeDefined();
  expect(toolResult.content).toBe("8");
  expect(toolResult.is_error).toBeFalsy();

  // Final result
  const result = messages.find((m) => m.type === "result" && m.subtype === "success") as any;
  expect(result).toBeDefined();
  expect(result.result).toBe("The result is 8");
});
