import { test, expect } from "bun:test";
import {
  calculateOpenAICost,
  findOpenAIPricing,
  OPENAI_CONTEXT_WINDOWS,
} from "../../src/utils/cost.ts";
import { OpenAIAdapter } from "../../src/providers/openai.ts";

// ─── Cost calculation ────────────────────────────────────────────────────────

test("calculates cost for gpt-4.1", () => {
  const cost = calculateOpenAICost("gpt-4.1", {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  });
  // $2/M input + $8/M output = $10
  expect(cost).toBeCloseTo(10, 1);
});

test("calculates cost for gpt-4.1-mini", () => {
  const cost = calculateOpenAICost("gpt-4.1-mini", {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  });
  // $0.40/M input + $1.60/M output = $2
  expect(cost).toBeCloseTo(2, 1);
});

test("calculates cost with cache tokens", () => {
  const cost = calculateOpenAICost("gpt-4.1", {
    inputTokens: 500_000,
    outputTokens: 100_000,
    cacheReadInputTokens: 500_000,
    cacheCreationInputTokens: 0,
  });
  // 0.5M * $2 + 0.1M * $8 + 0.5M * $0.5 = $1 + $0.8 + $0.25 = $2.05
  expect(cost).toBeCloseTo(2.05, 2);
});

test("returns 0 for unknown model", () => {
  const cost = calculateOpenAICost("unknown-model-xyz", {
    inputTokens: 1000,
    outputTokens: 1000,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  });
  expect(cost).toBe(0);
});

test("prefix match for dated model variants", () => {
  const pricing = findOpenAIPricing("gpt-4.1-2025-04-14");
  expect(pricing).toBeDefined();
  expect(pricing!.inputPerMillion).toBe(2);

  const miniPricing = findOpenAIPricing("gpt-4.1-mini-2025-04-14");
  expect(miniPricing).toBeDefined();
  expect(miniPricing!.inputPerMillion).toBe(0.4);
});

test("context window lookup", () => {
  expect(OPENAI_CONTEXT_WINDOWS["gpt-4.1"]).toBe(1_047_576);
  expect(OPENAI_CONTEXT_WINDOWS["gpt-4.1-mini"]).toBe(1_047_576);
  expect(OPENAI_CONTEXT_WINDOWS["gpt-4o"]).toBe(128_000);
  expect(OPENAI_CONTEXT_WINDOWS["o3"]).toBe(200_000);
});

// ─── Message conversion ──────────────────────────────────────────────────────

const adapter = new OpenAIAdapter({ apiKey: "test-key" });

test("converts simple user message with system prompt", () => {
  const result = adapter.convertMessages(
    [{ role: "user", content: "Hello" }],
    "You are helpful.",
  );
  expect(result).toEqual([
    { role: "developer", content: "You are helpful." },
    { role: "user", content: "Hello" },
  ]);
});

test("converts assistant with text + tool_use", () => {
  const result = adapter.convertMessages([
    {
      role: "assistant",
      content: [
        { type: "text", text: "Let me read that." },
        { type: "tool_use", id: "tc_1", name: "Read", input: { path: "/tmp/foo" } },
      ],
    },
  ]);
  expect(result).toEqual([
    {
      role: "assistant",
      content: "Let me read that.",
      tool_calls: [
        {
          id: "tc_1",
          type: "function",
          function: {
            name: "Read",
            arguments: '{"path":"/tmp/foo"}',
          },
        },
      ],
    },
  ]);
});

test("converts user with tool_result to role:tool messages", () => {
  const result = adapter.convertMessages([
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tc_1", content: "file contents here" },
      ],
    },
  ]);
  expect(result).toEqual([
    { role: "tool", tool_call_id: "tc_1", content: "file contents here" },
  ]);
});

test("converts mixed text + tool_results in user message", () => {
  const result = adapter.convertMessages([
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tc_1", content: "result1" },
        { type: "tool_result", tool_use_id: "tc_2", content: "result2" },
        { type: "text", text: "Now continue." },
      ],
    },
  ]);
  expect(result).toEqual([
    { role: "tool", tool_call_id: "tc_1", content: "result1" },
    { role: "tool", tool_call_id: "tc_2", content: "result2" },
    { role: "user", content: "Now continue." },
  ]);
});

test("converts assistant with only tool calls (no text)", () => {
  const result = adapter.convertMessages([
    {
      role: "assistant",
      content: [
        { type: "tool_use", id: "tc_1", name: "Bash", input: { command: "ls" } },
      ],
    },
  ]);
  expect(result).toEqual([
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "tc_1",
          type: "function",
          function: {
            name: "Bash",
            arguments: '{"command":"ls"}',
          },
        },
      ],
    },
  ]);
});

// ─── Responses API message conversion ───────────────────────────────────────

test("responses: converts simple user message", () => {
  const result = adapter.convertMessagesForResponses([
    { role: "user", content: "Hello" },
  ]);
  expect(result).toEqual([
    { role: "user", content: "Hello" },
  ]);
});

test("responses: converts assistant text + tool_use", () => {
  const result = adapter.convertMessagesForResponses([
    {
      role: "assistant",
      content: [
        { type: "text", text: "Let me read that." },
        { type: "tool_use", id: "tc_1", name: "Read", input: { path: "/tmp/foo" } },
      ],
    },
  ]);
  expect(result).toEqual([
    {
      role: "assistant",
      content: [{ type: "output_text", text: "Let me read that." }],
    },
    {
      type: "function_call",
      call_id: "tc_1",
      name: "Read",
      arguments: '{"path":"/tmp/foo"}',
    },
  ]);
});

test("responses: converts user tool_result to function_call_output", () => {
  const result = adapter.convertMessagesForResponses([
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tc_1", content: "file contents" },
      ],
    },
  ]);
  expect(result).toEqual([
    {
      type: "function_call_output",
      call_id: "tc_1",
      output: "file contents",
    },
  ]);
});

test("responses: converts mixed tool_results + text in user message", () => {
  const result = adapter.convertMessagesForResponses([
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tc_1", content: "result1" },
        { type: "text", text: "Now continue." },
      ],
    },
  ]);
  expect(result).toEqual([
    { type: "function_call_output", call_id: "tc_1", output: "result1" },
    { role: "user", content: "Now continue." },
  ]);
});

test("responses: full multi-turn conversation", () => {
  const result = adapter.convertMessagesForResponses([
    { role: "user", content: "Read /tmp/test.txt" },
    {
      role: "assistant",
      content: [
        { type: "text", text: "I'll read that file." },
        { type: "tool_use", id: "tc_1", name: "Read", input: { file_path: "/tmp/test.txt" } },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tc_1", content: "hello world" },
      ],
    },
    {
      role: "assistant",
      content: [
        { type: "text", text: "The file contains: hello world" },
      ],
    },
  ]);
  expect(result).toEqual([
    { role: "user", content: "Read /tmp/test.txt" },
    {
      role: "assistant",
      content: [{ type: "output_text", text: "I'll read that file." }],
    },
    {
      type: "function_call",
      call_id: "tc_1",
      name: "Read",
      arguments: '{"file_path":"/tmp/test.txt"}',
    },
    {
      type: "function_call_output",
      call_id: "tc_1",
      output: "hello world",
    },
    {
      role: "assistant",
      content: [{ type: "output_text", text: "The file contains: hello world" }],
    },
  ]);
});
