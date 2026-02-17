import type {
  AssertionFailure,
  CompatScenario,
  RunTrace,
  ScenarioExpectations,
  ScenarioParityExpectations,
} from "./types.ts";

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function mergeExpectations(
  shared?: ScenarioExpectations,
  specific?: ScenarioExpectations,
): ScenarioExpectations {
  return {
    stopReasons: unique([...(shared?.stopReasons ?? []), ...(specific?.stopReasons ?? [])]),
    textIncludes: unique([...(shared?.textIncludes ?? []), ...(specific?.textIncludes ?? [])]),
    textMatches: [...(shared?.textMatches ?? []), ...(specific?.textMatches ?? [])],
    requiredTools: unique([...(shared?.requiredTools ?? []), ...(specific?.requiredTools ?? [])]),
    forbiddenTools: unique([...(shared?.forbiddenTools ?? []), ...(specific?.forbiddenTools ?? [])]),
    minToolCalls: specific?.minToolCalls ?? shared?.minToolCalls,
    maxToolCalls: specific?.maxToolCalls ?? shared?.maxToolCalls,
    maxTurns: specific?.maxTurns ?? shared?.maxTurns,
    maxErrors: specific?.maxErrors ?? shared?.maxErrors,
    requireStructuredOutput:
      specific?.requireStructuredOutput ?? shared?.requireStructuredOutput,
    minHookEvents: specific?.minHookEvents ?? shared?.minHookEvents,
    requiredHookEvents: unique([
      ...(shared?.requiredHookEvents ?? []),
      ...(specific?.requiredHookEvents ?? []),
    ]),
  };
}

function evaluateTrace(
  trace: RunTrace,
  expected: ScenarioExpectations,
  scope: "fourmis" | "anthropic",
): AssertionFailure[] {
  const failures: AssertionFailure[] = [];
  const tools = trace.toolCalls.map((tool) => tool.name);
  const toolSet = new Set(tools);
  const normalizedText = normalizeText(trace.textOutput);

  if ((expected.maxErrors ?? 0) < trace.errors.length) {
    failures.push({
      scope,
      code: "errors_exceeded",
      message: `expected <= ${(expected.maxErrors ?? 0)} errors, got ${trace.errors.length}`,
    });
  }

  if (expected.stopReasons && expected.stopReasons.length > 0 && !expected.stopReasons.includes(trace.stopReason)) {
    failures.push({
      scope,
      code: "stop_reason_mismatch",
      message: `expected stopReason in [${expected.stopReasons.join(", ")}], got "${trace.stopReason}"`,
    });
  }

  for (const needle of expected.textIncludes ?? []) {
    if (!normalizedText.includes(normalizeText(needle))) {
      failures.push({
        scope,
        code: "text_missing",
        message: `text does not include "${needle}"`,
      });
    }
  }

  for (const pattern of expected.textMatches ?? []) {
    if (!pattern.test(trace.textOutput)) {
      failures.push({
        scope,
        code: "text_regex_mismatch",
        message: `text does not match ${pattern.toString()}`,
      });
    }
  }

  for (const requiredTool of expected.requiredTools ?? []) {
    if (!toolSet.has(requiredTool)) {
      failures.push({
        scope,
        code: "required_tool_missing",
        message: `required tool "${requiredTool}" was not used (used: ${tools.join(", ") || "none"})`,
      });
    }
  }

  for (const forbiddenTool of expected.forbiddenTools ?? []) {
    if (toolSet.has(forbiddenTool)) {
      failures.push({
        scope,
        code: "forbidden_tool_used",
        message: `forbidden tool "${forbiddenTool}" was used`,
      });
    }
  }

  if (typeof expected.minToolCalls === "number" && trace.toolCalls.length < expected.minToolCalls) {
    failures.push({
      scope,
      code: "min_tool_calls_not_met",
      message: `expected >= ${expected.minToolCalls} tool calls, got ${trace.toolCalls.length}`,
    });
  }

  if (typeof expected.maxToolCalls === "number" && trace.toolCalls.length > expected.maxToolCalls) {
    failures.push({
      scope,
      code: "max_tool_calls_exceeded",
      message: `expected <= ${expected.maxToolCalls} tool calls, got ${trace.toolCalls.length}`,
    });
  }

  if (typeof expected.maxTurns === "number" && trace.turns > expected.maxTurns) {
    failures.push({
      scope,
      code: "max_turns_exceeded",
      message: `expected <= ${expected.maxTurns} turns, got ${trace.turns}`,
    });
  }

  if (expected.requireStructuredOutput && trace.structuredOutput === undefined) {
    failures.push({
      scope,
      code: "structured_output_missing",
      message: "expected structured output but none was returned",
    });
  }

  if (typeof expected.minHookEvents === "number" && trace.hookEvents.length < expected.minHookEvents) {
    failures.push({
      scope,
      code: "min_hook_events_not_met",
      message: `expected >= ${expected.minHookEvents} hook events, got ${trace.hookEvents.length}`,
    });
  }

  for (const hookEvent of expected.requiredHookEvents ?? []) {
    if (!trace.hookEvents.includes(hookEvent)) {
      failures.push({
        scope,
        code: "required_hook_event_missing",
        message: `required hook event "${hookEvent}" missing`,
      });
    }
  }

  return failures;
}

function evaluateParity(
  fourmis: RunTrace,
  anthropic: RunTrace,
  expected: ScenarioParityExpectations | undefined,
): AssertionFailure[] {
  const failures: AssertionFailure[] = [];
  const parity = {
    sameStopReason: true,
    sameErrorCount: true,
    requiredToolsBoth: expected?.requiredToolsBoth,
    maxTurnDelta: expected?.maxTurnDelta,
    requireNonEmptyTextBoth: expected?.requireNonEmptyTextBoth,
  };

  if (parity.sameStopReason && fourmis.stopReason !== anthropic.stopReason) {
    failures.push({
      scope: "parity",
      code: "stop_reason_diff",
      message: `stopReason mismatch: fourmis=${fourmis.stopReason}, anthropic=${anthropic.stopReason}`,
    });
  }

  if (parity.sameErrorCount && fourmis.errors.length !== anthropic.errors.length) {
    failures.push({
      scope: "parity",
      code: "error_count_diff",
      message: `error count mismatch: fourmis=${fourmis.errors.length}, anthropic=${anthropic.errors.length}`,
    });
  }

  if (typeof parity.maxTurnDelta === "number") {
    const turnDelta = Math.abs(fourmis.turns - anthropic.turns);
    if (turnDelta > parity.maxTurnDelta) {
      failures.push({
        scope: "parity",
        code: "turn_delta_exceeded",
        message: `turn delta ${turnDelta} exceeds maxTurnDelta=${parity.maxTurnDelta}`,
      });
    }
  }

  if (parity.requireNonEmptyTextBoth) {
    if (!fourmis.textOutput.trim()) {
      failures.push({
        scope: "parity",
        code: "fourmis_empty_text",
        message: "fourmis returned empty text output",
      });
    }
    if (!anthropic.textOutput.trim()) {
      failures.push({
        scope: "parity",
        code: "anthropic_empty_text",
        message: "anthropic returned empty text output",
      });
    }
  }

  if (parity.requiredToolsBoth && parity.requiredToolsBoth.length > 0) {
    const fourmisToolSet = new Set(fourmis.toolCalls.map((tool) => tool.name));
    const anthropicToolSet = new Set(anthropic.toolCalls.map((tool) => tool.name));
    for (const tool of parity.requiredToolsBoth) {
      if (!fourmisToolSet.has(tool)) {
        failures.push({
          scope: "parity",
          code: "required_tool_missing_fourmis",
          message: `tool "${tool}" missing on fourmis side`,
        });
      }
      if (!anthropicToolSet.has(tool)) {
        failures.push({
          scope: "parity",
          code: "required_tool_missing_anthropic",
          message: `tool "${tool}" missing on anthropic side`,
        });
      }
    }
  }

  return failures;
}

export function evaluateScenario(
  scenario: CompatScenario,
  fourmis: RunTrace,
  anthropic: RunTrace,
): AssertionFailure[] {
  const failures: AssertionFailure[] = [];

  const fourmisExpectations = mergeExpectations(scenario.assertions.shared, scenario.assertions.fourmis);
  const anthropicExpectations = mergeExpectations(scenario.assertions.shared, scenario.assertions.anthropic);

  failures.push(...evaluateTrace(fourmis, fourmisExpectations, "fourmis"));
  failures.push(...evaluateTrace(anthropic, anthropicExpectations, "anthropic"));
  failures.push(...evaluateParity(fourmis, anthropic, scenario.assertions.parity));

  if (scenario.validateTrace?.fourmis) {
    for (const message of scenario.validateTrace.fourmis(fourmis, "fourmis")) {
      failures.push({
        scope: "fourmis",
        code: "custom_validation",
        message,
      });
    }
  }

  if (scenario.validateTrace?.anthropic) {
    for (const message of scenario.validateTrace.anthropic(anthropic, "anthropic")) {
      failures.push({
        scope: "anthropic",
        code: "custom_validation",
        message,
      });
    }
  }

  if (scenario.validateParity) {
    for (const message of scenario.validateParity(fourmis, anthropic)) {
      failures.push({
        scope: "parity",
        code: "custom_parity_validation",
        message,
      });
    }
  }

  return failures;
}
