/**
 * Strict Claude SDK compatibility harness.
 *
 * Runs fourmis (Anthropic provider) and @anthropic-ai/claude-agent-sdk side-by-side,
 * normalizes traces, evaluates assertions, and writes JSON/Markdown artifacts.
 *
 * Usage:
 *   bun run tests/compat/run-compat.ts
 *
 * Optional environment variables:
 *   COMPAT_REPEATS=3
 *   COMPAT_SCENARIOS=01-simple-text,02-read-package
 *   COMPAT_OUTPUT_DIR=/absolute/path
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { evaluateScenario } from "./assertions.ts";
import { runScenarioPair } from "./harness.ts";
import { writeCompatArtifacts } from "./report.ts";
import { getCompatScenarios } from "./scenarios.ts";
import type {
  CompatRunSummary,
  CompatScenario,
  RunTrace,
  ScenarioRunResult,
} from "./types.ts";

function parseRepeats(raw: string | undefined): number {
  const parsed = Number(raw ?? "1");
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

function parseScenarioFilter(raw: string | undefined): Set<string> {
  if (!raw || !raw.trim()) return new Set<string>();
  return new Set(
    raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function runStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtUsd(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function makeFatalTrace(sdk: "fourmis" | "anthropic", scenarioId: string, runId: string, error: unknown): RunTrace {
  const message = error instanceof Error ? error.message : String(error);
  const now = new Date().toISOString();
  return {
    sdk,
    scenarioId,
    runId,
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    durationApiMs: 0,
    ttftMs: 0,
    turns: 0,
    costUsd: 0,
    stopReason: "exception",
    rawResultSubtype: "exception",
    errors: [message],
    textOutput: "",
    toolCalls: [],
    toolResults: [],
    hookEvents: [],
    permissionDenials: [],
    streamEventCounts: {
      textDelta: 0,
      thinkingDelta: 0,
      partialAssistant: 0,
    },
  };
}

const startWallMs = performance.now();
const startedAt = new Date().toISOString();

const repoRoot = join(import.meta.dir, "../..");
const outputBase = process.env.COMPAT_OUTPUT_DIR ?? join(repoRoot, "tests/compat/output");
const outputDir = join(outputBase, runStamp());

await mkdir(outputDir, { recursive: true });

const repeats = parseRepeats(process.env.COMPAT_REPEATS);
const scenarioFilter = parseScenarioFilter(process.env.COMPAT_SCENARIOS);

const allScenarios = getCompatScenarios(repoRoot);
const selectedScenarios = allScenarios.filter((scenario) => {
  if (scenarioFilter.size === 0) return true;
  return scenarioFilter.has(scenario.id);
});

if (selectedScenarios.length === 0) {
  console.error("No scenarios selected. Check COMPAT_SCENARIOS.");
  process.exit(1);
}

console.log("=".repeat(92));
console.log("  Claude Compatibility Harness: fourmis vs @anthropic-ai/claude-agent-sdk");
console.log("=".repeat(92));
console.log(`  Output Dir: ${outputDir}`);
console.log(`  Repeats: ${repeats}`);
console.log(`  Scenarios: ${selectedScenarios.map((scenario) => scenario.id).join(", ")}`);
console.log("=".repeat(92));

const results: ScenarioRunResult[] = [];

for (const scenario of selectedScenarios) {
  console.log(`\n## ${scenario.id}: ${scenario.name}`);
  console.log(`   ${scenario.description}`);

  for (let repeatIndex = 1; repeatIndex <= repeats; repeatIndex += 1) {
    const runId = `${scenario.id}.run-${repeatIndex}-${Date.now()}`;
    const scratchDir = join(outputDir, "scratch", scenario.id, `run-${repeatIndex}`);
    await mkdir(scratchDir, { recursive: true });

    const runLabel = `${scenario.id} [${repeatIndex}/${repeats}]`;
    console.log(`\n  -> ${runLabel}`);

    let fourmis: RunTrace;
    let anthropic: RunTrace;

    try {
      const traces = await runScenarioPair(scenario, {
        repoRoot,
        scratchDir,
        scenarioId: scenario.id,
        repeatIndex,
        runId,
      });
      fourmis = traces.fourmis;
      anthropic = traces.anthropic;
    } catch (error: unknown) {
      fourmis = makeFatalTrace("fourmis", scenario.id, runId, error);
      anthropic = makeFatalTrace("anthropic", scenario.id, runId, error);
    }

    const failures = evaluateScenario(scenario, fourmis, anthropic);
    const passed = failures.length === 0;

    const result: ScenarioRunResult = {
      scenario,
      runId,
      repeatIndex,
      fourmis,
      anthropic,
      failures,
      passed,
    };
    results.push(result);

    const status = passed ? "PASS" : "FAIL";
    console.log(`     ${status}`);
    console.log(
      `     fourmis:   stop=${fourmis.stopReason} turns=${fourmis.turns} time=${fmtMs(fourmis.durationMs)} cost=${fmtUsd(fourmis.costUsd)} tools=${fourmis.toolCalls.map((tool) => tool.name).join(", ") || "(none)"}`,
    );
    console.log(
      `     anthropic: stop=${anthropic.stopReason} turns=${anthropic.turns} time=${fmtMs(anthropic.durationMs)} cost=${fmtUsd(anthropic.costUsd)} tools=${anthropic.toolCalls.map((tool) => tool.name).join(", ") || "(none)"}`,
    );

    const fourmisText = compact(fourmis.textOutput).slice(0, 140);
    const anthropicText = compact(anthropic.textOutput).slice(0, 140);
    if (fourmisText) console.log(`     fourmis text:   ${fourmisText}`);
    if (anthropicText) console.log(`     anthropic text: ${anthropicText}`);

    if (!passed) {
      for (const failure of failures) {
        console.log(`     [${failure.scope}] ${failure.code}: ${failure.message}`);
      }
    }
  }
}

const totalRuns = results.length;
const passedRuns = results.filter((result) => result.passed).length;
const failedRuns = totalRuns - passedRuns;
const finishedAt = new Date().toISOString();

const summary: CompatRunSummary = {
  startedAt,
  finishedAt,
  runDurationMs: Math.round(performance.now() - startWallMs),
  repeats,
  selectedScenarios: selectedScenarios.map((scenario: CompatScenario) => scenario.id),
  totalRuns,
  passedRuns,
  failedRuns,
  results,
};

const artifacts = await writeCompatArtifacts(outputDir, summary);

console.log(`\n${"=".repeat(92)}`);
console.log("  SUMMARY");
console.log(`${"=".repeat(92)}`);
console.log(`  Total runs: ${summary.totalRuns}`);
console.log(`  Passed: ${summary.passedRuns}`);
console.log(`  Failed: ${summary.failedRuns}`);
console.log(`  Summary JSON: ${artifacts.summaryPath}`);
console.log(`  Report MD: ${artifacts.markdownPath}`);
console.log(`  Traces: ${artifacts.tracesDir}`);
console.log(`${"=".repeat(92)}`);

if (failedRuns > 0) {
  process.exit(1);
}
