import { test, expect, beforeEach, afterAll } from "bun:test";
import { EditTool } from "../../src/tools/edit.ts";
import type { ToolContext } from "../../src/tools/registry.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let testDir: string;
let testFile: string;
const ctx: ToolContext = {
  cwd: "/tmp",
  signal: new AbortController().signal,
  sessionId: "test",
};

const ORIGINAL = `function greet(name) {
  console.log("Hello, " + name);
}

greet("world");
`;

beforeEach(async () => {
  if (!testDir) {
    testDir = await mkdtemp(join(tmpdir(), "edit-test-"));
  }
  testFile = join(testDir, "test.ts");
  await Bun.write(testFile, ORIGINAL);
});

afterAll(async () => {
  await rm(testDir, { recursive: true });
});

test("replaces unique string", async () => {
  const result = await EditTool.execute(
    {
      file_path: testFile,
      old_string: 'console.log("Hello, " + name)',
      new_string: 'console.log(`Hello, ${name}!`)',
    },
    ctx,
  );
  expect(result.isError).toBeUndefined();
  expect(result.content).toContain("Successfully replaced 1");

  const content = await Bun.file(testFile).text();
  expect(content).toContain("console.log(`Hello, ${name}!`)");
});

test("fails on non-unique string without replace_all", async () => {
  // Create file with duplicate content
  const dupFile = join(testDir, "dup.ts");
  await Bun.write(dupFile, "foo\nbar\nfoo\n");

  const result = await EditTool.execute(
    { file_path: dupFile, old_string: "foo", new_string: "baz" },
    ctx,
  );
  expect(result.isError).toBe(true);
  expect(result.content).toContain("appears 2 times");
});

test("replace_all replaces all occurrences", async () => {
  const dupFile = join(testDir, "dup2.ts");
  await Bun.write(dupFile, "foo\nbar\nfoo\n");

  const result = await EditTool.execute(
    { file_path: dupFile, old_string: "foo", new_string: "baz", replace_all: true },
    ctx,
  );
  expect(result.isError).toBeUndefined();
  expect(result.content).toContain("Successfully replaced 2");

  const content = await Bun.file(dupFile).text();
  expect(content).toBe("baz\nbar\nbaz\n");
});

test("fails when old_string not found", async () => {
  const result = await EditTool.execute(
    { file_path: testFile, old_string: "nonexistent", new_string: "replacement" },
    ctx,
  );
  expect(result.isError).toBe(true);
  expect(result.content).toContain("not found");
});

test("fails when old_string equals new_string", async () => {
  const result = await EditTool.execute(
    { file_path: testFile, old_string: "foo", new_string: "foo" },
    ctx,
  );
  expect(result.isError).toBe(true);
  expect(result.content).toContain("identical");
});

test("fails for nonexistent file", async () => {
  const result = await EditTool.execute(
    { file_path: "/nonexistent.ts", old_string: "a", new_string: "b" },
    ctx,
  );
  expect(result.isError).toBe(true);
});
