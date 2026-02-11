import { test, expect } from "bun:test";
import { z } from "zod";
import { tool, createMcpServer } from "../../src/mcp/server.ts";

test("tool() creates a valid definition", () => {
  const t = tool(
    "greet",
    "Greets a person",
    { name: z.string() },
    async (input) => `Hello, ${input.name}!`,
  );

  expect(t.name).toBe("greet");
  expect(t.description).toBe("Greets a person");
  expect(t.schema).toBeDefined();
  expect(typeof t.handler).toBe("function");
});

test("createMcpServer() returns config with type sdk", () => {
  const greet = tool(
    "greet",
    "Greets a person",
    { name: z.string() },
    async (input) => `Hello, ${input.name}!`,
  );

  const config = createMcpServer({
    name: "test-server",
    tools: [greet],
  });

  expect(config.type).toBe("sdk");
  expect(config.name).toBe("test-server");
  expect(config.instance).toBeDefined();
  expect(typeof config.instance.connect).toBe("function");
});

test("createMcpServer() with no tools", () => {
  const config = createMcpServer({
    name: "empty-server",
    version: "2.0.0",
  });

  expect(config.type).toBe("sdk");
  expect(config.name).toBe("empty-server");
});

test("createMcpServer() with multiple tools", () => {
  const tools = [
    tool("add", "Adds numbers", { a: z.number(), b: z.number() }, async (input) => String(input.a + input.b)),
    tool("greet", "Greets", { name: z.string() }, async (input) => `Hi, ${input.name}`),
  ];

  const config = createMcpServer({
    name: "multi-tool",
    tools,
  });

  expect(config.type).toBe("sdk");
  expect(config.name).toBe("multi-tool");
});
