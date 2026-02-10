/**
 * Smoke test — manual verification of the full pipeline.
 *
 * Run: bun test-smoke.ts
 * Requires ANTHROPIC_API_KEY in environment.
 */

import { query } from "./src/index.ts";

const conversation = query({
  prompt: "Read the file package.json and tell me the project name",
  options: {
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250929",
    cwd: "/root/dev/fourmis-agent-sdk",
    tools: "coding",
    maxTurns: 5,
    maxBudgetUsd: 0.10,
    permissionMode: "bypassPermissions",
  },
});

for await (const msg of conversation) {
  switch (msg.type) {
    case "init":
      console.log(`[init] session=${msg.sessionId} model=${msg.model} tools=${msg.tools.join(",")}`);
      break;
    case "text":
      process.stdout.write(msg.text);
      break;
    case "tool_use":
      console.log(`\n[tool_use] ${msg.name}(${JSON.stringify(msg.input).slice(0, 100)})`);
      break;
    case "tool_result":
      console.log(`[tool_result] ${msg.name}: ${msg.content.slice(0, 200)}${msg.content.length > 200 ? "..." : ""}`);
      break;
    case "result":
      if (msg.subtype === "success") {
        console.log(`\n[result] success — turns=${msg.turns} cost=$${msg.costUsd.toFixed(4)} duration=${msg.durationMs}ms`);
      } else {
        console.log(`\n[result] ${msg.subtype} — ${msg.errors.join(", ")}`);
      }
      break;
  }
}
