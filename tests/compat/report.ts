import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompatRunSummary, ScenarioRunResult } from "./types.ts";

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtUsd(usd: number): string {
  if (!Number.isFinite(usd)) return "$0.0000";
  return `$${usd.toFixed(4)}`;
}

function toolNames(result: ScenarioRunResult["fourmis"]): string {
  const names = result.toolCalls.map((tool) => tool.name);
  if (names.length === 0) return "(none)";
  return names.join(", ");
}

function uniqueScenarioIds(results: ScenarioRunResult[]): string[] {
  return Array.from(new Set(results.map((entry) => entry.scenario.id)));
}

function scenarioRollup(results: ScenarioRunResult[]): Map<string, { pass: number; fail: number }> {
  const rollup = new Map<string, { pass: number; fail: number }>();

  for (const result of results) {
    const bucket = rollup.get(result.scenario.id) ?? { pass: 0, fail: 0 };
    if (result.passed) bucket.pass += 1;
    else bucket.fail += 1;
    rollup.set(result.scenario.id, bucket);
  }

  return rollup;
}

function buildMarkdown(summary: CompatRunSummary): string {
  const lines: string[] = [];
  const rollup = scenarioRollup(summary.results);

  lines.push("# Compatibility Report");
  lines.push("");
  lines.push(`- Started: ${summary.startedAt}`);
  lines.push(`- Finished: ${summary.finishedAt}`);
  lines.push(`- Duration: ${fmtMs(summary.runDurationMs)}`);
  lines.push(`- Repeats per scenario: ${summary.repeats}`);
  lines.push(`- Selected scenarios: ${summary.selectedScenarios.join(", ") || "(all)"}`);
  lines.push(`- Runs: ${summary.totalRuns}`);
  lines.push(`- Passed: ${summary.passedRuns}`);
  lines.push(`- Failed: ${summary.failedRuns}`);
  lines.push("");

  lines.push("## Scenario Stability");
  lines.push("");
  lines.push("| Scenario | Pass | Fail |");
  lines.push("| --- | ---: | ---: |");
  for (const scenarioId of uniqueScenarioIds(summary.results)) {
    const row = rollup.get(scenarioId) ?? { pass: 0, fail: 0 };
    lines.push(`| ${scenarioId} | ${row.pass} | ${row.fail} |`);
  }
  lines.push("");

  lines.push("## Run Details");
  lines.push("");
  lines.push("| Scenario | Run | Status | Fourmis Stop | Anthropic Stop | Fourmis Tools | Anthropic Tools | Fourmis Time | Anthropic Time | Fourmis Cost | Anthropic Cost |");
  lines.push("| --- | ---: | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: |");

  for (const result of summary.results) {
    lines.push(
      `| ${result.scenario.id} | ${result.repeatIndex} | ${result.passed ? "PASS" : "FAIL"} | ` +
        `${result.fourmis.stopReason} | ${result.anthropic.stopReason} | ${toolNames(result.fourmis)} | ` +
        `${toolNames(result.anthropic)} | ${fmtMs(result.fourmis.durationMs)} | ${fmtMs(result.anthropic.durationMs)} | ` +
        `${fmtUsd(result.fourmis.costUsd)} | ${fmtUsd(result.anthropic.costUsd)} |`,
    );
  }

  const failures = summary.results.filter((entry) => !entry.passed);
  lines.push("");
  lines.push("## Failures");
  lines.push("");

  if (failures.length === 0) {
    lines.push("No assertion failures.");
    return lines.join("\n") + "\n";
  }

  for (const failed of failures) {
    lines.push(`### ${failed.scenario.id} (run ${failed.repeatIndex})`);
    lines.push("");
    for (const assertion of failed.failures) {
      lines.push(`- [${assertion.scope}] ${assertion.code}: ${assertion.message}`);
    }
    lines.push("");
    lines.push(`- Fourmis text: ${failed.fourmis.textOutput.trim().slice(0, 320) || "(empty)"}`);
    lines.push(`- Anthropic text: ${failed.anthropic.textOutput.trim().slice(0, 320) || "(empty)"}`);
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

export async function writeCompatArtifacts(
  outputDir: string,
  summary: CompatRunSummary,
): Promise<{ markdownPath: string; summaryPath: string; tracesDir: string }> {
  const tracesDir = join(outputDir, "traces");
  await mkdir(tracesDir, { recursive: true });

  for (const result of summary.results) {
    const base = `${result.scenario.id}.run-${result.repeatIndex}`;
    await writeFile(
      join(tracesDir, `${base}.fourmis.json`),
      JSON.stringify(result.fourmis, null, 2),
      "utf8",
    );
    await writeFile(
      join(tracesDir, `${base}.anthropic.json`),
      JSON.stringify(result.anthropic, null, 2),
      "utf8",
    );
  }

  const summaryPath = join(outputDir, "summary.json");
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");

  const markdownPath = join(outputDir, "report.md");
  await writeFile(markdownPath, buildMarkdown(summary), "utf8");

  return { markdownPath, summaryPath, tracesDir };
}
