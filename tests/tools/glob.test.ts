import { test, expect, beforeAll, afterAll } from "bun:test";
import { GlobTool } from "../../src/tools/glob.ts";
import type { ToolContext } from "../../src/tools/registry.ts";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let testDir: string;
const ctx: ToolContext = {
  cwd: "/tmp",
  signal: new AbortController().signal,
  sessionId: "test",
};

beforeAll(async () => {
  testDir = await mkdtemp(join(tmpdir(), "glob-test-"));

  // Create test files
  await Bun.write(join(testDir, "foo.ts"), "ts file");
  await Bun.write(join(testDir, "bar.ts"), "ts file");
  await Bun.write(join(testDir, "baz.js"), "js file");
  await mkdir(join(testDir, "sub"), { recursive: true });
  await Bun.write(join(testDir, "sub", "deep.ts"), "deep ts");
});

afterAll(async () => {
  await rm(testDir, { recursive: true });
});

test("matches *.ts files", async () => {
  const result = await GlobTool.execute(
    { pattern: "*.ts", path: testDir },
    ctx,
  );
  expect(result.content).toContain("foo.ts");
  expect(result.content).toContain("bar.ts");
  expect(result.content).not.toContain("baz.js");
});

test("matches **/*.ts recursively", async () => {
  const result = await GlobTool.execute(
    { pattern: "**/*.ts", path: testDir },
    ctx,
  );
  expect(result.content).toContain("foo.ts");
  expect(result.content).toContain("deep.ts");
});

test("returns no matches message", async () => {
  const result = await GlobTool.execute(
    { pattern: "*.xyz", path: testDir },
    ctx,
  );
  expect(result.content).toContain("No files matched");
});

test("uses cwd when no path specified", async () => {
  const result = await GlobTool.execute(
    { pattern: "*.ts" },
    { ...ctx, cwd: testDir },
  );
  expect(result.content).toContain("foo.ts");
});
