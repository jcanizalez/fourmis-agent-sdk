import { test, expect } from "bun:test";
import { query } from "../../src/index.ts";
import type { AgentMessage } from "../../src/index.ts";

/**
 * OpenAI integration test — requires OPENAI_API_KEY to be set.
 * Skipped automatically if the key is not available.
 */

const hasApiKey = !!process.env.OPENAI_API_KEY;

test.skipIf(!hasApiKey)("end-to-end: OpenAI reads file and reports", async () => {
  const conversation = query({
    prompt: "Read the file /root/dev/fourmis-agent-sdk/package.json and tell me the project name. Be brief — just say the name.",
    options: {
      provider: "openai",
      model: "gpt-4.1-mini",
      cwd: "/root/dev/fourmis-agent-sdk",
      tools: { type: "preset", preset: "claude_code" },
      maxTurns: 5,
      maxBudgetUsd: 0.10,
      permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
    },
  });

  const messages: AgentMessage[] = [];
  for await (const msg of conversation) {
    messages.push(msg);
  }

  // Should have init
  expect(messages.some((m) => m.type === "system" && m.subtype === "init")).toBe(true);

  // Should have used the Read tool
  const toolUse = messages
    .filter((m) => m.type === "assistant")
    .flatMap((m: any) => m.message.content)
    .find((c: any) => c.type === "tool_use");
  expect(toolUse).toBeDefined();
  expect((toolUse as any).name).toBe("Read");

  // Should have a success result
  const result = messages.find((m) => m.type === "result" && m.subtype === "success") as any;
  expect(result).toBeDefined();
  expect(result.total_cost_usd).toBeGreaterThan(0);

  // Should mention the project name
  const textMsg = messages
    .filter((m) => m.type === "assistant")
    .flatMap((m: any) => m.message.content)
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("");
  expect(textMsg.toLowerCase()).toContain("fourmis");
}, 30_000);
