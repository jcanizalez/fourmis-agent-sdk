import { test, expect, afterEach } from "bun:test";
import { z } from "zod";
import { McpClientManager } from "../../src/mcp/client.ts";
import { tool, createMcpServer } from "../../src/mcp/server.ts";

let manager: McpClientManager | undefined;

afterEach(async () => {
  if (manager) {
    await manager.closeAll();
    manager = undefined;
  }
});

test("connect to in-process SDK server and list tools", async () => {
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

  manager = new McpClientManager({ "test-server": config });
  await manager.connectAll();

  const status = manager.status();
  expect(status).toHaveLength(1);
  expect(status[0].status).toBe("connected");
  expect(status[0].tools).toHaveLength(1);
  expect(status[0].tools![0].name).toBe("greet");
});

test("call a tool on in-process SDK server", async () => {
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

  manager = new McpClientManager({ "test-server": config });
  await manager.connectAll();

  const result = await manager.callTool("test-server", "greet", { name: "World" });
  expect(result.isError).toBeFalsy();
  expect(result.content).toBe("Hello, World!");
});

test("getTools() returns namespaced ToolImplementation", async () => {
  const greet = tool(
    "greet",
    "Greets a person",
    { name: z.string() },
    async (input) => `Hello, ${input.name}!`,
  );

  const config = createMcpServer({
    name: "myserver",
    tools: [greet],
  });

  manager = new McpClientManager({ myserver: config });
  await manager.connectAll();

  const tools = manager.getTools();
  expect(tools).toHaveLength(1);
  expect(tools[0].name).toBe("myserver__greet");
  expect(tools[0].description).toBe("Greets a person");

  // Execute the wrapped tool
  const result = await tools[0].execute({ name: "SDK" }, {} as any);
  expect(result.content).toBe("Hello, SDK!");
});

test("call tool on disconnected server returns error", async () => {
  manager = new McpClientManager({});
  const result = await manager.callTool("nonexistent", "greet", {});
  expect(result.isError).toBe(true);
  expect(result.content).toContain("not connected");
});

test("status() shows pending for unconnected servers", () => {
  manager = new McpClientManager({
    server1: { command: "nonexistent-binary", args: [] },
  });

  const status = manager.status();
  expect(status).toHaveLength(1);
  expect(status[0].name).toBe("server1");
  expect(status[0].status).toBe("pending");
});

test("multiple servers connect independently", async () => {
  const add = tool(
    "add",
    "Adds two numbers",
    { a: z.number(), b: z.number() },
    async (input) => String(input.a + input.b),
  );

  const multiply = tool(
    "multiply",
    "Multiplies two numbers",
    { a: z.number(), b: z.number() },
    async (input) => String(input.a * input.b),
  );

  const server1 = createMcpServer({ name: "math-add", tools: [add] });
  const server2 = createMcpServer({ name: "math-mul", tools: [multiply] });

  manager = new McpClientManager({
    "math-add": server1,
    "math-mul": server2,
  });

  await manager.connectAll();

  const status = manager.status();
  expect(status).toHaveLength(2);
  expect(status.every((s) => s.status === "connected")).toBe(true);

  const tools = manager.getTools();
  expect(tools).toHaveLength(2);
  expect(tools.map((t) => t.name).sort()).toEqual([
    "math-add__add",
    "math-mul__multiply",
  ]);

  const addResult = await manager.callTool("math-add", "add", { a: 3, b: 4 });
  expect(addResult.content).toBe("7");

  const mulResult = await manager.callTool("math-mul", "multiply", { a: 3, b: 4 });
  expect(mulResult.content).toBe("12");
});
