# Compatibility Harness

`tests/compat` is the strict side-by-side compatibility suite for:

- `fourmis` (`query()` with `provider: "anthropic"`)
- `@anthropic-ai/claude-agent-sdk`

It replaces the previous `tests/compare` scripts.

## What it validates

- Stop reason parity and error-shape parity
- Tool usage requirements per scenario
- Hook behavior parity (observe + deny)
- MCP parity (single and multi-server)
- Subagent delegation parity (`Task`)
- Structured output parity (`json_schema`)
- Budget-limit behavior parity

## Run

```bash
bun run tests/compat/run-compat.ts
```

## Useful env vars

- `COMPAT_REPEATS=3`: rerun each scenario 3 times for stability checks
- `COMPAT_SCENARIOS=01-simple-text,02-read-package`: run a subset
- `COMPAT_OUTPUT_DIR=/path/to/output`: choose artifact directory

## Artifacts

Each run writes:

- `summary.json`: machine-readable run summary
- `report.md`: human-readable report with failures
- `traces/*.json`: normalized per-SDK traces for each scenario run
