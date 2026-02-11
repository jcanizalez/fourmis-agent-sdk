import { test, expect } from "bun:test";
import { agentLoop } from "../../src/agent-loop.ts";
import { ToolRegistry } from "../../src/tools/registry.ts";
import { PermissionManager } from "../../src/permissions.ts";
import { TaskManager } from "../../src/agents/task-manager.ts";
import { createTaskTool, createTaskOutputTool, createTaskStopTool } from "../../src/agents/tools.ts";
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

test("parent agent calls Task → subagent runs → result feeds back", async () => {
  // The subagent's provider: returns a simple text response
  const subagentProvider = createMockProvider([
    { text: "Subagent analysis: everything looks good" },
  ]);

  // The parent's provider: first calls Task, then uses the result
  const parentProvider = createMockProvider([
    {
      text: "Let me delegate this to a subagent.",
      toolCalls: [{
        id: "task-call-1",
        name: "Task",
        input: {
          prompt: "Analyze the code",
          subagent_type: "reviewer",
        },
      }],
    },
    { text: "The subagent said everything looks good!" },
  ]);

  const taskManager = new TaskManager();
  const permissions = new PermissionManager("bypassPermissions");

  // Set up parent tools with Task/TaskOutput/TaskStop
  const tools = new ToolRegistry();
  const agentCtx = {
    agents: {
      reviewer: {
        description: "Code reviewer",
        prompt: "You review code and provide feedback.",
        maxTurns: 3,
      },
    },
    parentProvider: subagentProvider,
    parentModel: "test-model",
    parentPermissions: permissions,
    parentCwd: "/tmp",
    taskManager,
  };

  tools.register(createTaskTool(agentCtx));
  tools.register(createTaskOutputTool(taskManager));
  tools.register(createTaskStopTool(taskManager));

  // Run the parent agent
  const messages: AgentMessage[] = [];
  for await (const msg of agentLoop("Review this code", {
    provider: parentProvider,
    model: "test-model",
    systemPrompt: "You are a helpful assistant.",
    tools,
    permissions,
    cwd: "/tmp",
    sessionId: "parent-session",
    maxTurns: 10,
    maxBudgetUsd: 1,
    includeStreamEvents: false,
    signal: new AbortController().signal,
  })) {
    messages.push(msg);
  }

  // Check that Task tool was called
  const toolUse = messages.find((m) => m.type === "tool_use" && (m as any).name === "Task") as any;
  expect(toolUse).toBeDefined();

  // Check that tool result contains subagent output
  const toolResult = messages.find((m) => m.type === "tool_result" && (m as any).name === "Task") as any;
  expect(toolResult).toBeDefined();
  expect(toolResult.content).toContain("Subagent analysis: everything looks good");

  // Check final result
  const result = messages.find((m) => m.type === "result" && m.subtype === "success") as any;
  expect(result).toBeDefined();
  expect(result.text).toBe("The subagent said everything looks good!");
});
