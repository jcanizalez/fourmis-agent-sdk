/**
 * AskUserQuestion tool.
 * In this in-process runtime, direct interactive prompting is not available.
 */

import type { ToolImplementation, ToolResult } from "./registry.ts";

export const AskUserQuestionTool: ToolImplementation = {
  name: "AskUserQuestion",
  description: "Ask the user a clarifying question and wait for their response.",
  inputSchema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "Question to ask the user.",
      },
      options: {
        type: "array",
        items: { type: "string" },
        description: "Optional fixed choices.",
      },
    },
    required: ["question"],
  },

  async execute(input: unknown): Promise<ToolResult> {
    const { question, options } = (input ?? {}) as {
      question?: string;
      options?: string[];
    };

    if (!question) {
      return { content: "Error: question is required", isError: true };
    }

    const choices = Array.isArray(options) && options.length > 0
      ? ` Choices: ${options.join(" | ")}`
      : "";

    return {
      content:
        `User interaction is not available in this runtime. Unanswered question: ${question}.${choices}`,
      isError: true,
    };
  },
};
