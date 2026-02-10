import { test, expect, beforeAll, afterAll } from "bun:test";
import { WriteTool } from "../../src/tools/write.ts";
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
  testDir = await mkdtemp(join(tmpdir(), "write-test-"));
});

afterAll(async () => {
  await rm(testDir, { recursive: true });
});

test("writes a file", async () => {
  const filePath = join(testDir, "out.txt");
  const result = await WriteTool.execute(
    { file_path: filePath, content: "hello world\n" },
    ctx,
  );
  expect(result.isError).toBeUndefined();
  expect(result.content).toContain("Successfully wrote");

  const content = await Bun.file(filePath).text();
  expect(content).toBe("hello world\n");
});

test("creates parent directories", async () => {
  const filePath = join(testDir, "a", "b", "c", "deep.txt");
  const result = await WriteTool.execute(
    { file_path: filePath, content: "deep file\n" },
    ctx,
  );
  expect(result.isError).toBeUndefined();

  const content = await Bun.file(filePath).text();
  expect(content).toBe("deep file\n");
});

test("overwrites existing file", async () => {
  const filePath = join(testDir, "overwrite.txt");
  await Bun.write(filePath, "original");

  const result = await WriteTool.execute(
    { file_path: filePath, content: "replaced" },
    ctx,
  );
  expect(result.isError).toBeUndefined();

  const content = await Bun.file(filePath).text();
  expect(content).toBe("replaced");
});

test("returns error when file_path missing", async () => {
  const result = await WriteTool.execute({ content: "test" }, ctx);
  expect(result.isError).toBe(true);
});
