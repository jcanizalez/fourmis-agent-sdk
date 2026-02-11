import { test, expect } from "bun:test";
import { TaskManager } from "../../src/agents/task-manager.ts";
import type { BackgroundTask } from "../../src/agents/types.ts";

function makeTask(overrides?: Partial<BackgroundTask>): BackgroundTask {
  const abortController = new AbortController();
  let resolvePromise: () => void;
  const promise = new Promise<void>((resolve) => { resolvePromise = resolve; });
  return {
    id: "task-1",
    agentType: "test-agent",
    status: "running",
    abortController,
    promise,
    ...overrides,
    // Expose resolve for test control
    ...(overrides?.promise ? {} : { _resolve: resolvePromise! }),
  } as BackgroundTask & { _resolve?: () => void };
}

test("register and get a task", () => {
  const tm = new TaskManager();
  const task = makeTask();
  tm.register(task);

  const retrieved = tm.get("task-1");
  expect(retrieved).toBeDefined();
  expect(retrieved!.id).toBe("task-1");
  expect(retrieved!.status).toBe("running");
});

test("get returns undefined for unknown task", () => {
  const tm = new TaskManager();
  expect(tm.get("unknown")).toBeUndefined();
});

test("getOutput returns not found for unknown task", async () => {
  const tm = new TaskManager();
  const output = await tm.getOutput("unknown", false, 1000);
  expect(output).toContain("not found");
});

test("getOutput non-blocking returns running status", async () => {
  const tm = new TaskManager();
  const task = makeTask();
  tm.register(task);

  const output = await tm.getOutput("task-1", false, 1000);
  expect(output).toContain("still running");
});

test("getOutput returns result for completed task", async () => {
  const tm = new TaskManager();
  const task = makeTask();
  task.status = "completed";
  task.result = "Task completed successfully";
  tm.register(task);

  const output = await tm.getOutput("task-1", false, 1000);
  expect(output).toBe("Task completed successfully");
});

test("getOutput returns error for failed task", async () => {
  const tm = new TaskManager();
  const task = makeTask();
  task.status = "failed";
  task.error = "Something went wrong";
  tm.register(task);

  const output = await tm.getOutput("task-1", false, 1000);
  expect(output).toContain("failed");
  expect(output).toContain("Something went wrong");
});

test("getOutput blocking waits for completion", async () => {
  const tm = new TaskManager();
  let resolvePromise: () => void;
  const promise = new Promise<void>((resolve) => { resolvePromise = resolve; });
  const task: BackgroundTask = {
    id: "task-2",
    agentType: "test",
    status: "running",
    abortController: new AbortController(),
    promise,
  };
  tm.register(task);

  // Complete after a short delay
  setTimeout(() => {
    task.status = "completed";
    task.result = "Done!";
    resolvePromise();
  }, 50);

  const output = await tm.getOutput("task-2", true, 5000);
  expect(output).toBe("Done!");
});

test("getOutput blocking times out", async () => {
  const tm = new TaskManager();
  const task = makeTask({ id: "task-timeout" });
  tm.register(task);

  const output = await tm.getOutput("task-timeout", true, 50);
  expect(output).toContain("timed out");
});

test("stop a running task", () => {
  const tm = new TaskManager();
  const task = makeTask({ id: "task-stop" });
  tm.register(task);

  const stopped = tm.stop("task-stop");
  expect(stopped).toBe(true);
  expect(tm.get("task-stop")!.status).toBe("stopped");
});

test("stop a non-running task returns false", () => {
  const tm = new TaskManager();
  const task = makeTask({ id: "task-completed" });
  task.status = "completed";
  tm.register(task);

  const stopped = tm.stop("task-completed");
  expect(stopped).toBe(false);
});

test("stop an unknown task returns false", () => {
  const tm = new TaskManager();
  expect(tm.stop("unknown")).toBe(false);
});

test("list returns all tasks", () => {
  const tm = new TaskManager();
  tm.register(makeTask({ id: "t1" }));
  tm.register(makeTask({ id: "t2" }));

  const tasks = tm.list();
  expect(tasks).toHaveLength(2);
  expect(tasks.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
});
