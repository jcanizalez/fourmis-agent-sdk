import { test, expect } from "bun:test";
import { BashTool } from "../../src/tools/bash.ts";
import type { ToolContext } from "../../src/tools/registry.ts";

const ctx: ToolContext = {
  cwd: "/tmp",
  signal: new AbortController().signal,
  sessionId: "test",
};

test("executes simple command", async () => {
  const result = await BashTool.execute({ command: "echo hello" }, ctx);
  expect(result.content.trim()).toBe("hello");
  expect(result.isError).toBeUndefined();
});

test("captures stderr", async () => {
  const result = await BashTool.execute({ command: "echo err >&2" }, ctx);
  expect(result.content.trim()).toBe("err");
});

test("reports exit code on failure", async () => {
  const result = await BashTool.execute({ command: "exit 1" }, ctx);
  expect(result.isError).toBe(true);
});

test("respects working directory", async () => {
  const result = await BashTool.execute({ command: "pwd" }, { ...ctx, cwd: "/tmp" });
  const pwd = result.content.trim();
  expect(pwd === "/tmp" || pwd === "/private/tmp").toBe(true);
});

test("truncates long output", async () => {
  const result = await BashTool.execute(
    { command: "yes | head -100000" },
    ctx,
  );
  expect(result.content.length).toBeLessThanOrEqual(30_100); // 30k + truncation message
  expect(result.content).toContain("truncated");
});

test("returns error for missing command", async () => {
  const result = await BashTool.execute({}, ctx);
  expect(result.isError).toBe(true);
  expect(result.content).toContain("command is required");
});

test("handles timeout", async () => {
  const result = await BashTool.execute(
    { command: "sleep 10", timeout: 500 },
    ctx,
  );
  // Should complete quickly due to kill, may have error
  expect(result).toBeDefined();
}, 5000);
