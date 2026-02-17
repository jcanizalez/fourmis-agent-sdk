import { test, expect } from "bun:test";
import { HookManager } from "../src/hooks.ts";
import type { HookEvent, HookInput, SyncHookJSONOutput, HookCallbackMatcher } from "../src/hooks.ts";
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
      yield { type: "usage", usage: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } };
      yield { type: "done", stopReason: response.toolCalls ? "tool_use" : "end_turn" };
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

const failTool: ToolImplementation = {
  name: "Fail",
  description: "Always fails",
  inputSchema: { type: "object", properties: {} },
  async execute() {
    return { content: "Tool failed!", isError: true };
  },
};

// ─── HookManager unit tests ─────────────────────────────────────────────────

test("HookManager.fire() with no hooks returns null", async () => {
  const manager = new HookManager();
  const result = await manager.fire("PreToolUse", { event: "PreToolUse" });
  expect(result).toBeNull();
});

test("HookManager.hasHooks() returns false for empty", () => {
  const manager = new HookManager();
  expect(manager.hasHooks("PreToolUse")).toBe(false);
});

test("HookManager.hasHooks() returns true when hooks exist", () => {
  const manager = new HookManager({
    PreToolUse: [{ hooks: [async () => ({})] }],
  });
  expect(manager.hasHooks("PreToolUse")).toBe(true);
});

test("PreToolUse hook can deny execution", async () => {
  const manager = new HookManager({
    PreToolUse: [{
      hooks: [async () => ({ permissionDecision: "deny" as const })],
    }],
  });

  const result = await manager.fire("PreToolUse", {
    event: "PreToolUse",
    tool_name: "Echo",
    tool_input: { text: "hello" },
  });

  expect(result).not.toBeNull();
  expect(result!.permissionDecision).toBe("deny");
});

test("PreToolUse hook can modify input", async () => {
  const manager = new HookManager({
    PreToolUse: [{
      hooks: [async () => ({ updatedInput: { text: "modified" } })],
    }],
  });

  const result = await manager.fire("PreToolUse", {
    event: "PreToolUse",
    tool_name: "Echo",
    tool_input: { text: "original" },
  });

  expect(result).not.toBeNull();
  expect(result!.updatedInput).toEqual({ text: "modified" });
});

test("PreToolUse matcher regex filters by tool name", async () => {
  const calls: string[] = [];
  const manager = new HookManager({
    PreToolUse: [{
      matcher: "^Echo$",
      hooks: [async (input) => {
        calls.push(input.tool_name!);
        return {};
      }],
    }],
  });

  // Should match Echo
  await manager.fire("PreToolUse", { event: "PreToolUse", tool_name: "Echo" });
  expect(calls).toEqual(["Echo"]);

  // Should NOT match Bash
  await manager.fire("PreToolUse", { event: "PreToolUse", tool_name: "Bash" });
  expect(calls).toEqual(["Echo"]); // still just one call
});

test("PreToolUse matcher with empty string matches all tools", async () => {
  const calls: string[] = [];
  const manager = new HookManager({
    PreToolUse: [{
      hooks: [async (input) => {
        calls.push(input.tool_name!);
        return {};
      }],
    }],
  });

  await manager.fire("PreToolUse", { event: "PreToolUse", tool_name: "Echo" });
  await manager.fire("PreToolUse", { event: "PreToolUse", tool_name: "Bash" });
  expect(calls).toEqual(["Echo", "Bash"]);
});

test("first deny wins across matchers", async () => {
  const manager = new HookManager({
    PreToolUse: [
      { hooks: [async () => ({ permissionDecision: "allow" as const })] },
      { hooks: [async () => ({ permissionDecision: "deny" as const })] },
    ],
  });

  const result = await manager.fire("PreToolUse", {
    event: "PreToolUse",
    tool_name: "Echo",
  });

  expect(result!.permissionDecision).toBe("deny");
});

test("last updatedInput wins", async () => {
  const manager = new HookManager({
    PreToolUse: [
      { hooks: [async () => ({ updatedInput: { text: "first" } })] },
      { hooks: [async () => ({ updatedInput: { text: "second" } })] },
    ],
  });

  const result = await manager.fire("PreToolUse", {
    event: "PreToolUse",
    tool_name: "Echo",
  });

  expect(result!.updatedInput).toEqual({ text: "second" });
});

test("additionalContext concatenates", async () => {
  const manager = new HookManager({
    PostToolUse: [
      { hooks: [async () => ({ additionalContext: "context A" })] },
      { hooks: [async () => ({ additionalContext: "context B" })] },
    ],
  });

  const result = await manager.fire("PostToolUse", {
    event: "PostToolUse",
    tool_name: "Echo",
    tool_result: "Echo: hello",
  });

  expect(result!.additionalContext).toBe("context A\ncontext B");
});

// ─── Integration with agent loop ────────────────────────────────────────────

test("PreToolUse hook denies → tool not executed", async () => {
  const toolExecuted: boolean[] = [];
  const trackingTool: ToolImplementation = {
    ...echoTool,
    async execute(input: unknown) {
      toolExecuted.push(true);
      return echoTool.execute(input, {} as any);
    },
  };

  const hooks = new HookManager({
    PreToolUse: [{
      hooks: [async () => ({ permissionDecision: "deny" as const })],
    }],
  });

  const provider = createMockProvider([
    { toolCalls: [{ id: "c1", name: "Echo", input: { text: "hello" } }] },
    { text: "Tool was denied" },
  ]);

  const tools = new ToolRegistry();
  tools.register(trackingTool);
  const permissions = new PermissionManager("bypassPermissions");

  const messages: AgentMessage[] = [];
  for await (const msg of agentLoop("Test", {
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
    hooks,
  })) {
    messages.push(msg);
  }

  // Tool should NOT have been executed
  expect(toolExecuted).toHaveLength(0);

  // Should have a denied tool_result
  const toolResult = messages
    .filter((m) => m.type === "user")
    .flatMap((m: any) => m.message.content)
    .find((c: any) => c.type === "tool_result");
  expect(toolResult).toBeDefined();
  expect((toolResult as any).is_error).toBe(true);
  expect((toolResult as any).content).toContain("Denied by hook");
});

test("PreToolUse hook modifies input → tool gets updated input", async () => {
  const receivedInputs: unknown[] = [];
  const trackingTool: ToolImplementation = {
    ...echoTool,
    async execute(input: unknown) {
      receivedInputs.push(input);
      const { text } = input as { text: string };
      return { content: `Echo: ${text}` };
    },
  };

  const hooks = new HookManager({
    PreToolUse: [{
      hooks: [async () => ({ updatedInput: { text: "modified-by-hook" } })],
    }],
  });

  const provider = createMockProvider([
    { toolCalls: [{ id: "c1", name: "Echo", input: { text: "original" } }] },
    { text: "Done" },
  ]);

  const tools = new ToolRegistry();
  tools.register(trackingTool);
  const permissions = new PermissionManager("bypassPermissions");

  const messages: AgentMessage[] = [];
  for await (const msg of agentLoop("Test", {
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
    hooks,
  })) {
    messages.push(msg);
  }

  expect(receivedInputs).toHaveLength(1);
  expect(receivedInputs[0]).toEqual({ text: "modified-by-hook" });
});

test("PostToolUse fires after successful execution", async () => {
  const postToolUseEvents: HookInput[] = [];

  const hooks = new HookManager({
    PostToolUse: [{
      hooks: [async (input) => {
        postToolUseEvents.push(input);
        return {};
      }],
    }],
  });

  const provider = createMockProvider([
    { toolCalls: [{ id: "c1", name: "Echo", input: { text: "hello" } }] },
    { text: "Done" },
  ]);

  const tools = new ToolRegistry();
  tools.register(echoTool);
  const permissions = new PermissionManager("bypassPermissions");

  for await (const _ of agentLoop("Test", {
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
    hooks,
  })) {
    // consume
  }

  expect(postToolUseEvents).toHaveLength(1);
  expect(postToolUseEvents[0].tool_name).toBe("Echo");
  expect(postToolUseEvents[0].tool_result).toBe("Echo: hello");
});

test("PostToolUseFailure fires on tool error", async () => {
  const failureEvents: HookInput[] = [];

  const hooks = new HookManager({
    PostToolUseFailure: [{
      hooks: [async (input) => {
        failureEvents.push(input);
        return {};
      }],
    }],
  });

  const provider = createMockProvider([
    { toolCalls: [{ id: "c1", name: "Fail", input: {} }] },
    { text: "Done" },
  ]);

  const tools = new ToolRegistry();
  tools.register(failTool);
  const permissions = new PermissionManager("bypassPermissions");

  for await (const _ of agentLoop("Test", {
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
    hooks,
  })) {
    // consume
  }

  expect(failureEvents).toHaveLength(1);
  expect(failureEvents[0].tool_name).toBe("Fail");
  expect(failureEvents[0].tool_error).toBe(true);
});

test("SessionStart and SessionEnd fire at loop boundaries", async () => {
  const events: string[] = [];

  const hooks = new HookManager({
    SessionStart: [{
      hooks: [async () => {
        events.push("SessionStart");
        return {};
      }],
    }],
    SessionEnd: [{
      hooks: [async () => {
        events.push("SessionEnd");
        return {};
      }],
    }],
  });

  const provider = createMockProvider([
    { text: "Hello" },
  ]);

  const tools = new ToolRegistry();
  const permissions = new PermissionManager("bypassPermissions");

  for await (const _ of agentLoop("Test", {
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
    hooks,
  })) {
    // consume
  }

  expect(events).toEqual(["SessionStart", "SessionEnd"]);
});

test("PostToolUse additionalContext appended to result", async () => {
  const hooks = new HookManager({
    PostToolUse: [{
      hooks: [async () => ({ additionalContext: "[hook context added]" })],
    }],
  });

  const provider = createMockProvider([
    { toolCalls: [{ id: "c1", name: "Echo", input: { text: "hello" } }] },
    { text: "Done" },
  ]);

  const tools = new ToolRegistry();
  tools.register(echoTool);
  const permissions = new PermissionManager("bypassPermissions");

  const messages: AgentMessage[] = [];
  for await (const msg of agentLoop("Test", {
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
    hooks,
  })) {
    messages.push(msg);
  }

  const toolResult = messages
    .filter((m) => m.type === "user")
    .flatMap((m: any) => m.message.content)
    .find((c: any) => c.type === "tool_result");
  expect(toolResult).toBeDefined();
  expect((toolResult as any).content).toContain("Echo: hello");
  expect((toolResult as any).content).toContain("[hook context added]");
});
