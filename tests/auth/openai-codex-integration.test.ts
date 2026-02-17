import { test, expect } from "bun:test";
import { query } from "../../src/index.ts";
import type { AgentMessage } from "../../src/index.ts";
import { isLoggedIn } from "../../src/auth/openai-oauth.ts";

/**
 * Codex/OAuth integration test — requires stored OAuth tokens.
 * Skipped if no tokens are available (user hasn't run `bun src/auth/login-openai.ts`).
 * Also skipped if OPENAI_API_KEY is set (API key takes priority over Codex mode).
 */

const canRun = isLoggedIn() && !process.env.OPENAI_API_KEY;

test.skipIf(!canRun)("end-to-end: Codex OAuth reads file via Responses API", async () => {
  const conversation = query({
    prompt: "Read the file /root/dev/fourmis-agent-sdk/package.json and tell me the project name. Be brief — just say the name.",
    options: {
      provider: "openai",
      model: "gpt-5.3-codex",
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

  expect(messages.some((m) => m.type === "system" && m.subtype === "init")).toBe(true);

  const toolUse = messages
    .filter((m) => m.type === "assistant")
    .flatMap((m: any) => m.message.content)
    .find((c: any) => c.type === "tool_use");
  expect(toolUse).toBeDefined();
  expect((toolUse as any).name).toBe("Read");

  const result = messages.find((m) => m.type === "result" && m.subtype === "success") as any;
  expect(result).toBeDefined();

  const textMsg = messages
    .filter((m) => m.type === "assistant")
    .flatMap((m: any) => m.message.content)
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("");
  expect(textMsg.toLowerCase()).toContain("fourmis");
}, 30_000);
