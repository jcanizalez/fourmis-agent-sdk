import type { QueryOptions } from "../../src/index.ts";
import type { HookCallbackMatcher, HookEvent } from "../../src/hooks.ts";

export type CompatSdk = "fourmis" | "anthropic";

export type ScenarioContext = {
  repoRoot: string;
  scratchDir: string;
  scenarioId: string;
  repeatIndex: number;
  runId: string;
};

export type ScenarioRunConfig = {
  prompt: string;
  cwd?: string;
  model?: string;
  tools?: QueryOptions["tools"];
  maxTurns?: number;
  maxBudgetUsd?: number;
  sharedOptions?: Partial<QueryOptions>;
  fourmisOptions?: Partial<QueryOptions>;
  anthropicOptions?: Record<string, unknown>;
  buildHooks?: (
    sdk: CompatSdk,
    sink: string[],
  ) => Partial<Record<HookEvent, HookCallbackMatcher[]>> | undefined;
  buildMcpServers?: () => {
    fourmis: Record<string, unknown>;
    anthropic: Record<string, unknown>;
    cleanup?: () => Promise<void> | void;
  };
  cleanup?: () => Promise<void> | void;
};

export type ScenarioExpectations = {
  stopReasons?: string[];
  textIncludes?: string[];
  textMatches?: RegExp[];
  requiredTools?: string[];
  forbiddenTools?: string[];
  minToolCalls?: number;
  maxToolCalls?: number;
  maxTurns?: number;
  maxErrors?: number;
  requireStructuredOutput?: boolean;
  minHookEvents?: number;
  requiredHookEvents?: string[];
};

export type ScenarioParityExpectations = {
  sameStopReason?: boolean;
  sameErrorCount?: boolean;
  requiredToolsBoth?: string[];
  maxTurnDelta?: number;
  requireNonEmptyTextBoth?: boolean;
};

export type ScenarioAssertions = {
  shared?: ScenarioExpectations;
  fourmis?: ScenarioExpectations;
  anthropic?: ScenarioExpectations;
  parity?: ScenarioParityExpectations;
};

export type TraceValidator = (trace: RunTrace, sdk: CompatSdk) => string[];
export type ParityValidator = (fourmis: RunTrace, anthropic: RunTrace) => string[];

export type CompatScenario = {
  id: string;
  name: string;
  description: string;
  buildRunConfig: (ctx: ScenarioContext) => Promise<ScenarioRunConfig> | ScenarioRunConfig;
  assertions: ScenarioAssertions;
  validateTrace?: Partial<Record<CompatSdk, TraceValidator>>;
  validateParity?: ParityValidator;
};

export type ToolCallTrace = {
  id?: string;
  name: string;
  input: unknown;
};

export type ToolResultTrace = {
  toolUseId: string;
  name: string;
  isError: boolean;
  content: string;
};

export type RunTrace = {
  sdk: CompatSdk;
  scenarioId: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  durationApiMs: number;
  ttftMs: number;
  turns: number;
  costUsd: number;
  stopReason: string;
  rawResultSubtype?: string;
  errors: string[];
  textOutput: string;
  structuredOutput?: unknown;
  toolCalls: ToolCallTrace[];
  toolResults: ToolResultTrace[];
  hookEvents: string[];
  permissionDenials: string[];
  streamEventCounts: {
    textDelta: number;
    thinkingDelta: number;
    partialAssistant: number;
  };
};

export type AssertionFailure = {
  scope: CompatSdk | "parity";
  code: string;
  message: string;
};

export type ScenarioRunResult = {
  scenario: CompatScenario;
  runId: string;
  repeatIndex: number;
  fourmis: RunTrace;
  anthropic: RunTrace;
  failures: AssertionFailure[];
  passed: boolean;
};

export type CompatRunSummary = {
  startedAt: string;
  finishedAt: string;
  runDurationMs: number;
  repeats: number;
  selectedScenarios: string[];
  totalRuns: number;
  passedRuns: number;
  failedRuns: number;
  results: ScenarioRunResult[];
};
