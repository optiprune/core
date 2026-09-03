---
title: Core API
description: Integrate OptiPrune programmatically without the CLI.
---

The **Core API** is the programmatic analyzer in [`@optiprune/core`](https://www.npmjs.com/package/@optiprune/core). It is not a second product or a separate “headless API”: **headless** describes how the Core API runs without owning a terminal, process lifecycle, or user interface.

Install it when your application owns orchestration, reporting, editor integration, dashboards, or CI policy:

```bash
npm install @optiprune/core
```

## Analyze

```ts
import { analyze, shouldFail } from "@optiprune/core";

const report = await analyze({
  rootDir: process.cwd(),
  entry: ["src/index.ts"],
  extensions: [".ts", ".tsx", ".js", ".jsx", ".vue"],
  output: "json",
});

console.log(report.summary);
console.log(report.findings);

if (shouldFail(report, "high")) process.exitCode = 1;
```

`analyze()` returns a `Promise<AnalysisReport>`. It performs analysis and returns data; it does not silently edit source files. The `output` option describes the intended report format for callers, while the returned report remains structured data.

## Public exports

| Export | Use |
| --- | --- |
| `analyze(options)` | Run discovery, parsing, graph analysis, plugins, and finding generation. |
| `shouldFail(report, failOn)` | Apply a confidence threshold to decide a CI exit status. |
| `applyFixes(report, rootDir, config)` | Apply explicitly selected, confidence-gated fixes. Use `dryRun` first. |
| `defineConfig(config)` | Type-safe configuration helper; it returns the supplied config. |
| `loadConfig(rootDir)` | Load supported project configuration. |
| `mergeConfig(base, override)` | Merge configuration values. |
| `DEFAULT_CONFIG` | Inspect the Core defaults. |
| `exportCache` / `importCache` | Move cache state between environments. |

Additional entry points expose reporter functions and public types:

```ts
import { formatTerminal, formatSarif } from "@optiprune/core/reporters";
import type { AnalysisReport, AnalyzerOptions, Finding } from "@optiprune/core/types";
```

`formatTerminal(report, { showCycles: true })` returns the human-readable report used by the CLI-style output. `formatSarif(report)` returns a SARIF JSON string for code-scanning integrations.

## Core API versus CLI

| Concern | `@optiprune/cli` | `@optiprune/core` |
| --- | --- | --- |
| Installation | Ready-to-run command | Library dependency |
| Invocation | `npx @optiprune/cli analyze` | `await analyze(options)` |
| Output | Terminal, JSON, or SARIF flags | Structured `AnalysisReport`, plus reporter helpers |
| Process policy | CLI handles command exit behavior | Caller decides whether to fail, display, or store results |
| Fix workflow | CLI flags such as `--fix` and `--dry-run` | `applyFixes(report, rootDir, config)` |

Use [CLI](/docs/cli/) for the standard command workflow. Use this page when another program is the integration boundary.

## Configuration

The Core API accepts `AnalyzerOptions` directly. If you want repository configuration, use `loadConfig(rootDir)` or pass the resolved values to `analyze()`. Supported project sources are documented in [Configuration](/docs/configuration/).

## Extending analysis

Plugins are part of Core’s analysis pipeline, not a separate API layer. They can contribute evidence about framework conventions through the `AnalyzerPlugin` contract. Read [How plugins work](/docs/plugins/) for the lifecycle and [Writing a plugin](/docs/plugin-authoring/) for a complete implementation guide.
