import { test, expect, beforeAll, afterAll } from "bun:test";
import { GrepTool } from "../../src/tools/grep.ts";
import type { ToolContext } from "../../src/tools/registry.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let testDir: string;
let ctx: ToolContext;

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), "grep-test-"));
  ctx = {
    cwd: testDir,
    signal: new AbortController().signal,
    sessionId: "test",
  };

  await Bun.write(join(testDir, "hello.ts"), `function greet(name: string) {
  console.log("Hello, " + name);
}

greet("world");
`);

  await Bun.write(join(testDir, "data.json"), `{
  "name": "test",
  "version": "1.0.0"
}
`);
});

afterAll(async () => {
  await rm(testDir, { recursive: true });
});

test("finds files with matches (default mode)", async () => {
  const result = await GrepTool.execute(
    { pattern: "greet", path: testDir },
    ctx,
  );
  expect(result.content).toContain("hello.ts");
});

test("shows matching lines in content mode", async () => {
  const result = await GrepTool.execute(
    { pattern: "greet", path: testDir, output_mode: "content" },
    ctx,
  );
  expect(result.content).toContain("greet");
});

test("counts matches", async () => {
  const result = await GrepTool.execute(
    { pattern: "greet", path: testDir, output_mode: "count" },
    ctx,
  );
  // Should show count for hello.ts
  expect(result.content).toContain("hello.ts");
});

test("case insensitive search", async () => {
  const result = await GrepTool.execute(
    { pattern: "GREET", path: testDir, "-i": true },
    ctx,
  );
  expect(result.content).toContain("hello.ts");
});

test("returns no matches for nonexistent pattern", async () => {
  const result = await GrepTool.execute(
    { pattern: "zzzzzzz_nonexistent", path: testDir },
    ctx,
  );
  expect(result.content).toContain("No matches");
});

test("filters by glob pattern", async () => {
  const result = await GrepTool.execute(
    { pattern: "name", path: testDir, glob: "*.json" },
    ctx,
  );
  expect(result.content).toContain("data.json");
  expect(result.content).not.toContain("hello.ts");
});

test("respects head_limit", async () => {
  const result = await GrepTool.execute(
    { pattern: ".", path: testDir, output_mode: "files_with_matches", head_limit: 1 },
    ctx,
  );
  const lines = result.content.trim().split("\n");
  expect(lines.length).toBe(1);
});
