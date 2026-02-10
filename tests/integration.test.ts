import { test, expect } from "bun:test";
import { query } from "../src/index.ts";
import type { AgentMessage } from "../src/index.ts";

/**
 * Integration test — requires ANTHROPIC_API_KEY to be set.
 * Skipped automatically if the key is not available.
 */

const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

test.skipIf(!hasApiKey)("end-to-end: read file and report", async () => {
  const conversation = query({
    prompt: "Read the file /root/dev/fourmis-agent-sdk/package.json and tell me the project name. Be brief — just say the name.",
    options: {
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      cwd: "/root/dev/fourmis-agent-sdk",
      tools: "coding",
      maxTurns: 5,
      maxBudgetUsd: 0.10,
      permissionMode: "bypassPermissions",
    },
  });

  const messages: AgentMessage[] = [];
  for await (const msg of conversation) {
    messages.push(msg);
  }

  // Should have init
  expect(messages.some((m) => m.type === "init")).toBe(true);

  // Should have used the Read tool
  const toolUse = messages.find((m) => m.type === "tool_use") as any;
  expect(toolUse).toBeDefined();
  expect(toolUse.name).toBe("Read");

  // Should have a success result
  const result = messages.find((m) => m.type === "result" && m.subtype === "success") as any;
  expect(result).toBeDefined();
  expect(result.costUsd).toBeGreaterThan(0);

  // Should mention the project name
  const textMsg = messages.filter((m) => m.type === "text").map((m: any) => m.text).join("");
  expect(textMsg.toLowerCase()).toContain("fourmis");
}, 30_000);
