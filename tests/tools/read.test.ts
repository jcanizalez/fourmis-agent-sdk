import { test, expect, beforeAll, afterAll } from "bun:test";
import { ReadTool } from "../../src/tools/read.ts";
import type { ToolContext } from "../../src/tools/registry.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let testDir: string;
const ctx: ToolContext = {
  cwd: "/tmp",
  signal: new AbortController().signal,
  sessionId: "test",
};

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), "read-test-"));

  // Create test file
  await Bun.write(join(testDir, "test.txt"), "line one\nline two\nline three\nline four\nline five\n");

  // Create file with long lines
  const longLine = "x".repeat(3000);
  await Bun.write(join(testDir, "long.txt"), longLine + "\nshort\n");
});

afterAll(async () => {
  await rm(testDir, { recursive: true });
});

test("reads file with line numbers", async () => {
  const result = await ReadTool.execute({ file_path: join(testDir, "test.txt") }, ctx);
  expect(result.content).toContain("1\tline one");
  expect(result.content).toContain("2\tline two");
  expect(result.isError).toBeUndefined();
});

test("supports offset and limit", async () => {
  const result = await ReadTool.execute(
    { file_path: join(testDir, "test.txt"), offset: 2, limit: 2 },
    ctx,
  );
  expect(result.content).toContain("2\tline two");
  expect(result.content).toContain("3\tline three");
  expect(result.content).not.toContain("1\tline one");
  expect(result.content).not.toContain("4\tline four");
});

test("truncates long lines", async () => {
  const result = await ReadTool.execute({ file_path: join(testDir, "long.txt") }, ctx);
  expect(result.content).toContain("truncated");
});

test("returns error for nonexistent file", async () => {
  const result = await ReadTool.execute({ file_path: "/nonexistent/file.txt" }, ctx);
  expect(result.isError).toBe(true);
  expect(result.content).toContain("not found");
});

test("returns error when file_path missing", async () => {
  const result = await ReadTool.execute({}, ctx);
  expect(result.isError).toBe(true);
});
