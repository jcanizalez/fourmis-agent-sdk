import { test, expect, beforeAll, afterAll } from "bun:test";
import { agentLoop } from "../src/agent-loop.ts";
import { ToolRegistry } from "../src/tools/registry.ts";
import type { ToolImplementation } from "../src/tools/registry.ts";
import { PermissionManager } from "../src/permissions.ts";
import type { ProviderAdapter, ChatRequest, ChatChunk, ProviderFeature } from "../src/providers/types.ts";
import type { AgentMessage, TokenUsage } from "../src/types.ts";

// ─── Mock Provider ──────────────────────────────────────────────────────────

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

      if (response.text) {
        yield { type: "text_delta", text: response.text };
      }

      if (response.toolCalls) {
        for (const call of response.toolCalls) {
          yield { type: "tool_call", id: call.id, name: call.name, input: call.input };
        }
      }

      yield {
        type: "usage",
        usage: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      };

      yield {
        type: "done",
        stopReason: response.toolCalls ? "tool_use" : "end_turn",
      };
    },

    calculateCost(_model: string, usage: TokenUsage): number {
      return (usage.inputTokens + usage.outputTokens) * 0.00001;
    },

    getContextWindow(_model: string): number {
      return 200_000;
    },

    supportsFeature(_feature: ProviderFeature): boolean {
      return true;
    },
  };
}

// ─── Mock Tool ──────────────────────────────────────────────────────────────

const echoTool: ToolImplementation = {
  name: "Echo",
  description: "Echoes the input back",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  async execute(input: unknown) {
    const { text } = input as { text: string };
    return { content: `Echo: ${text}` };
  },
};

// ─── Tests ──────────────────────────────────────────────────────────────────

test("simple text response (no tools)", async () => {
  const provider = createMockProvider([
    { text: "Hello! I can help you." },
  ]);

  const tools = new ToolRegistry();
  const permissions = new PermissionManager("bypassPermissions");

  const messages: AgentMessage[] = [];
  for await (const msg of agentLoop("Hi", {
    provider,
    model: "test-model",
    systemPrompt: "You are helpful.",
    tools,
    permissions,
    cwd: "/tmp",
    sessionId: "test-session",
    maxTurns: 10,
    maxBudgetUsd: 1,
    includePartialMessages: false,
    signal: new AbortController().signal,
  })) {
    messages.push(msg);
  }

  const initMsg = messages.find((m) => m.type === "system" && m.subtype === "init");
  expect(initMsg).toBeDefined();

  const assistantMsg = messages.find((m) => m.type === "assistant");
  expect(assistantMsg).toBeDefined();
  expect((assistantMsg as any).message.content).toContainEqual({ type: "text", text: "Hello! I can help you." });

  const resultMsg = messages.find((m) => m.type === "result" && m.subtype === "success");
  expect(resultMsg).toBeDefined();
  expect((resultMsg as any).num_turns).toBe(1);
});

test("tool call and response", async () => {
  const provider = createMockProvider([
    // First response: call tool
    {
      text: "Let me echo that for you.",
      toolCalls: [{ id: "call_1", name: "Echo", input: { text: "hello" } }],
    },
    // Second response: final answer after tool result
    { text: "The echo returned: hello" },
  ]);

  const tools = new ToolRegistry();
  tools.register(echoTool);
  const permissions = new PermissionManager("bypassPermissions");

  const messages: AgentMessage[] = [];
  for await (const msg of agentLoop("Echo hello", {
    provider,
    model: "test-model",
    systemPrompt: "You are helpful.",
    tools,
    permissions,
    cwd: "/tmp",
    sessionId: "test-session",
    maxTurns: 10,
    maxBudgetUsd: 1,
    includePartialMessages: false,
    signal: new AbortController().signal,
  })) {
    messages.push(msg);
  }

  // Should have assistant tool_use blocks and user tool_result blocks
  const toolUse = messages
    .filter((m) => m.type === "assistant")
    .flatMap((m: any) => m.message.content)
    .find((c: any) => c.type === "tool_use");
  expect(toolUse).toBeDefined();
  expect((toolUse as any).name).toBe("Echo");

  const toolResult = messages
    .filter((m) => m.type === "user")
    .flatMap((m: any) => m.message.content)
    .find((c: any) => c.type === "tool_result");
  expect(toolResult).toBeDefined();
  expect((toolResult as any).content).toBe("Echo: hello");

  const result = messages.find((m) => m.type === "result" && m.subtype === "success");
  expect(result).toBeDefined();
  expect((result as any).num_turns).toBe(2);
});

test("max turns limit", async () => {
  // Provider always returns tool calls — should hit turn limit
  const provider = createMockProvider([
    { toolCalls: [{ id: "c1", name: "Echo", input: { text: "1" } }] },
    { toolCalls: [{ id: "c2", name: "Echo", input: { text: "2" } }] },
    { toolCalls: [{ id: "c3", name: "Echo", input: { text: "3" } }] },
  ]);

  const tools = new ToolRegistry();
  tools.register(echoTool);
  const permissions = new PermissionManager("bypassPermissions");

  const messages: AgentMessage[] = [];
  for await (const msg of agentLoop("Loop forever", {
    provider,
    model: "test-model",
    systemPrompt: "You are helpful.",
    tools,
    permissions,
    cwd: "/tmp",
    sessionId: "test-session",
    maxTurns: 2,
    maxBudgetUsd: 100,
    includePartialMessages: false,
    signal: new AbortController().signal,
  })) {
    messages.push(msg);
  }

  const errorMsg = messages.find((m) => m.type === "result" && m.subtype === "error_max_turns");
  expect(errorMsg).toBeDefined();
});

test("permission denial", async () => {
  const provider = createMockProvider([
    { toolCalls: [{ id: "c1", name: "Echo", input: { text: "denied" } }] },
    { text: "Tool was denied" },
  ]);

  const tools = new ToolRegistry();
  tools.register(echoTool);
  const permissions = new PermissionManager("default", async () => ({
    behavior: "deny",
    message: "Not allowed in test",
  }));

  const messages: AgentMessage[] = [];
  for await (const msg of agentLoop("Try echo", {
    provider,
    model: "test-model",
    systemPrompt: "You are helpful.",
    tools,
    permissions,
    cwd: "/tmp",
    sessionId: "test-session",
    maxTurns: 10,
    maxBudgetUsd: 1,
    includePartialMessages: false,
    signal: new AbortController().signal,
  })) {
    messages.push(msg);
  }

  const toolResult = messages
    .filter((m) => m.type === "user")
    .flatMap((m: any) => m.message.content)
    .find((c: any) => c.type === "tool_result");
  expect(toolResult).toBeDefined();
  expect((toolResult as any).is_error).toBe(true);
  expect((toolResult as any).content).toContain("Permission denied");
});

test("streaming events when enabled", async () => {
  const provider = createMockProvider([
    { text: "Hello stream!" },
  ]);

  const tools = new ToolRegistry();
  const permissions = new PermissionManager("bypassPermissions");

  const messages: AgentMessage[] = [];
  for await (const msg of agentLoop("Hi", {
    provider,
    model: "test-model",
    systemPrompt: "You are helpful.",
    tools,
    permissions,
    cwd: "/tmp",
    sessionId: "test-session",
    maxTurns: 10,
    maxBudgetUsd: 1,
    includePartialMessages: true,
    signal: new AbortController().signal,
  })) {
    messages.push(msg);
  }

  const streamMsg = messages.find((m) => m.type === "stream_event");
  expect(streamMsg).toBeDefined();
  expect((streamMsg as any).event.type).toBe("text_delta");
});

test("cost tracking", async () => {
  const provider = createMockProvider([
    { text: "Done!" },
  ]);

  const tools = new ToolRegistry();
  const permissions = new PermissionManager("bypassPermissions");

  const messages: AgentMessage[] = [];
  for await (const msg of agentLoop("Calculate cost", {
    provider,
    model: "test-model",
    systemPrompt: "You are helpful.",
    tools,
    permissions,
    cwd: "/tmp",
    sessionId: "test-session",
    maxTurns: 10,
    maxBudgetUsd: 1,
    includePartialMessages: false,
    signal: new AbortController().signal,
  })) {
    messages.push(msg);
  }

  const result = messages.find((m) => m.type === "result" && m.subtype === "success") as any;
  expect(result).toBeDefined();
  expect(result.total_cost_usd).toBeGreaterThan(0);
  expect(result.usage.inputTokens).toBeGreaterThan(0);
  expect(result.duration_ms).toBeGreaterThanOrEqual(0);
});
