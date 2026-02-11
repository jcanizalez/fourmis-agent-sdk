import { test, expect } from "bun:test";
import { createTaskTool, createTaskOutputTool, createTaskStopTool } from "../../src/agents/tools.ts";
import type { AgentContext } from "../../src/agents/tools.ts";
import { TaskManager } from "../../src/agents/task-manager.ts";
import { ToolRegistry } from "../../src/tools/registry.ts";
import { PermissionManager } from "../../src/permissions.ts";
import { HookManager } from "../../src/hooks.ts";
import type { HookInput } from "../../src/hooks.ts";
import type { ProviderAdapter, ChatRequest, ChatChunk, ProviderFeature } from "../../src/providers/types.ts";
import type { TokenUsage } from "../../src/types.ts";

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

function makeContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    agents: {
      researcher: {
        description: "A research agent",
        prompt: "You are a researcher. Answer questions directly.",
        maxTurns: 3,
      },
    },
    parentProvider: createMockProvider([{ text: "I am the subagent responding" }]),
    parentModel: "test-model",
    parentPermissions: new PermissionManager("bypassPermissions"),
    parentCwd: "/tmp",
    taskManager: new TaskManager(),
    ...overrides,
  };
}

const toolCtx = {
  cwd: "/tmp",
  signal: new AbortController().signal,
  sessionId: "parent-session",
};

// ─── Task Tool Tests ─────────────────────────────────────────────────────────

test("Task tool: foreground execution returns subagent result", async () => {
  const ctx = makeContext();
  const taskTool = createTaskTool(ctx);

  const result = await taskTool.execute({
    prompt: "What is 2+2?",
    subagent_type: "researcher",
  }, toolCtx);

  expect(result.isError).toBeFalsy();
  expect(result.content).toBe("I am the subagent responding");
});

test("Task tool: unknown agent type returns error", async () => {
  const ctx = makeContext();
  const taskTool = createTaskTool(ctx);

  const result = await taskTool.execute({
    prompt: "Test",
    subagent_type: "nonexistent",
  }, toolCtx);

  expect(result.isError).toBe(true);
  expect(result.content).toContain("Unknown agent type");
  expect(result.content).toContain("researcher");
});

test("Task tool: background execution returns task ID", async () => {
  const ctx = makeContext();
  const taskTool = createTaskTool(ctx);

  const result = await taskTool.execute({
    prompt: "Background task",
    subagent_type: "researcher",
    run_in_background: true,
  }, toolCtx);

  expect(result.isError).toBeFalsy();
  expect(result.content).toContain("Background task started");
  expect(result.content).toContain("TaskOutput");

  // Task should be registered in the task manager
  const tasks = ctx.taskManager.list();
  expect(tasks).toHaveLength(1);
  expect(tasks[0].agentType).toBe("researcher");
});

test("Task tool: background task completes and result is retrievable", async () => {
  const ctx = makeContext();
  const taskTool = createTaskTool(ctx);

  await taskTool.execute({
    prompt: "Background task",
    subagent_type: "researcher",
    run_in_background: true,
  }, toolCtx);

  const tasks = ctx.taskManager.list();
  const taskId = tasks[0].id;

  // Wait for completion
  const output = await ctx.taskManager.getOutput(taskId, true, 5000);
  expect(output).toBe("I am the subagent responding");
});

test("Task tool: SubagentStart and SubagentStop hooks fire", async () => {
  const hookEvents: string[] = [];
  const hooks = new HookManager({
    SubagentStart: [{
      hooks: [async (input: HookInput) => {
        hookEvents.push(`start:${input.agent_type}`);
        return {};
      }],
    }],
    SubagentStop: [{
      hooks: [async (input: HookInput) => {
        hookEvents.push(`stop:${input.agent_type}`);
        return {};
      }],
    }],
  });

  const ctx = makeContext({ parentHooks: hooks });
  const taskTool = createTaskTool(ctx);

  await taskTool.execute({
    prompt: "Test hooks",
    subagent_type: "researcher",
  }, toolCtx);

  expect(hookEvents).toEqual(["start:researcher", "stop:researcher"]);
});

// ─── TaskOutput Tool Tests ───────────────────────────────────────────────────

test("TaskOutput tool: returns not found for unknown task", async () => {
  const tm = new TaskManager();
  const taskOutputTool = createTaskOutputTool(tm);

  const result = await taskOutputTool.execute({
    task_id: "unknown",
  }, toolCtx);

  expect(result.content).toContain("not found");
});

test("TaskOutput tool: non-blocking returns running status", async () => {
  const tm = new TaskManager();
  tm.register({
    id: "bg-1",
    agentType: "test",
    status: "running",
    abortController: new AbortController(),
    promise: new Promise(() => {}), // never resolves
  });

  const taskOutputTool = createTaskOutputTool(tm);
  const result = await taskOutputTool.execute({
    task_id: "bg-1",
    block: false,
  }, toolCtx);

  expect(result.content).toContain("still running");
});

// ─── TaskStop Tool Tests ─────────────────────────────────────────────────────

test("TaskStop tool: stops a running task", async () => {
  const tm = new TaskManager();
  tm.register({
    id: "bg-stop",
    agentType: "test",
    status: "running",
    abortController: new AbortController(),
    promise: new Promise(() => {}),
  });

  const taskStopTool = createTaskStopTool(tm);
  const result = await taskStopTool.execute({ task_id: "bg-stop" }, toolCtx);

  expect(result.content).toContain("stopped");
  expect(tm.get("bg-stop")!.status).toBe("stopped");
});

test("TaskStop tool: returns error for unknown task", async () => {
  const tm = new TaskManager();
  const taskStopTool = createTaskStopTool(tm);
  const result = await taskStopTool.execute({ task_id: "unknown" }, toolCtx);

  expect(result.isError).toBe(true);
  expect(result.content).toContain("not found");
});
