![OptiPrune analyzer animation](./animation.svg)

[![npm version](https://img.shields.io/npm/v/%40optiprune%2Fcore?label=%40optiprune%2Fcore)](https://www.npmjs.com/package/@optiprune/core)[![npm version](https://img.shields.io/npm/v/%40optiprune%2Fcli?label=%40optiprune%2Fcli)](https://www.npmjs.com/package/@optiprune/cli)[![Tests](https://img.shields.io/github/actions/workflow/status/optiprune/core/tests.yml?branch=main&label=tests)](https://github.com/optiprune/core/actions/workflows/tests.yml)[![License](https://img.shields.io/github/license/optiprune/core)](./LICENSE)[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D21-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
# @optiprune/core

`@optiprune/core` is the headless analysis engine behind OptiPrune. It analyzes TypeScript and JavaScript workspaces and returns structured reports that can be used from CI jobs, editor integrations, dashboards, custom developer tools, and the OptiPrune CLI.

The package does not require the CLI. Import the analysis functions, reporters, cache helpers, fix helpers, and TypeScript contracts directly from the package exports.

## What Core provides

| Area | Core capability |
| --- | --- |
| Reachability | Entry discovery, module graphs, exports, members, dependency edges, strongly connected components, and cycles. |
| Source parsing | TypeScript, TSX, JavaScript, JSX, and Vue-oriented source handling with parsed, recovered, and fallback parse statuses. |
| Dynamic paths | Literal and patterned dynamic-import candidates, unknown dynamic boundaries, unresolved imports, and isolated verification results. |
| Logic findings | Constant conditions, contradictory guards, unreachable statements, schema-impossible guards, and unreachable dynamic paths. |
| Project context | Package manifests, scripts, dependency/devDependency usage, package exports, bins, monorepos, workspaces, and external contracts. |
| Configuration | JSON, JSONC, TypeScript, JavaScript, MJS, and package-field configuration through the Core loader. |
| Fixes | Confidence-aware file, export/member, dependency, development-dependency, and condition fixes with dry-run and force controls. |
| Output | Structured `AnalysisReport`, terminal formatting, JSON serialization, and SARIF 2.1 formatting. |
| Plugins | Source-aware adapters for framework, build, test, runtime, package-manager, and workspace conventions. |

## Installation

```bash
npm install @optiprune/core
# or
pnpm add @optiprune/core
# or
yarn add @optiprune/core
```

Core currently requires Node.js 21 or newer.

## Basic usage

```
import { analyze, shouldFail } from "@optiprune/core";

const report = await analyze({
  rootDir: process.cwd(),
  entry: ["src/index.ts"],
  extensions: [".ts", ".tsx", ".js", ".jsx", ".vue"],
  output: "json",
});

console.log(report.summary);
console.log(report.findings);

if (shouldFail(report, "high")) {
  process.exitCode = 1;
}
```

`analyze()` returns a `Promise<AnalysisReport>`. The report includes the project root, discovered entry points, summary counters, findings, module records, exports, dependency edges, and strongly connected components.

## Analyzer options

The main `AnalyzerOptions` surface includes:

| Option | Purpose |
| --- | --- |
| `rootDir` | Project directory used as the analysis root. |
| `entry` | Explicit entry files or glob patterns. |
| `extensions` | Source extensions to include. |
| `ignore` | Additional ignore patterns. |
| `ignoreDependencies` | Dependency names to exclude from dependency findings. |
| `externalContracts` | Public symbols or contracts that should be treated as externally consumed. |
| `reportUnusedExports` | Enable or disable unused-export reporting. |
| `includeConventionalEntries` | Include conventional framework and project entry points. |
| `failOn` | Confidence threshold used by `shouldFail`. |
| `output` | `terminal`, `json`, or `sarif`. |
| `json` | Compatibility switch for JSON output. |
| `verbose` | Include additional diagnostic and graph information. |
| `fix` | Boolean or `FixConfig` for opt-in automated fixes. |
| `rules` | Per-rule `error`, `warning`, or `off` severity configuration. |
| `plugins` | Plugin enablement configuration. |
| `layers` | SMT, isolated execution, and layer-specific options. |

The authoritative configuration reference is [`schema.json`](./schema.json). It is also available from the [Core repository](https://github.com/optiprune/core/blob/main/schema.json).

## Configuration

The loader supports the following sources:

| Source | Format |
| --- | --- |
| `optiprune.json` | Standard JSON. |
| `optiprune.jsonc` | JSON with comments and trailing commas. |
| `optiprune.config.ts` | TypeScript default export. |
| `optiprune.config.js` | JavaScript ESM default export. |
| `optiprune.config.mjs` | JavaScript ESM default export. |
| `package.json#optiprune` | Package configuration field. |

Example TypeScript configuration:

```
import { defineConfig } from "@optiprune/core";

export default defineConfig({
  rootDir: ".",
  entry: ["src/index.ts"],
  ignore: ["**/fixtures/**"],
  reportUnusedExports: true,
  failOn: "high",
  output: "terminal",
  rules: {
    "unused-export": "warning",
    "unreachable-file": "warning",
    "constant-condition": "warning",
    "unreachable-dynamic-path": "warning",
  },
});
```

CLI-provided values are applied as explicit overrides. The loader merges project configuration with resolved Core defaults and preserves nested layer, rule, and plugin settings.

## Findings and confidence

Each `Finding` includes a rule, severity, confidence, message, file information, and an optional source location or evidence payload. Current rule names include:

| Rule | Meaning |
| --- | --- |
| `unused-export` | An exported symbol is not reachable from the configured roots. |
| `unused-member` | An exported or contracted member is not used. |
| `unreachable-file` | A source file is not reachable from the project roots. |
| `unreachable-statement` | A statement cannot be reached under the analyzed control flow. |
| `constant-condition` | A condition is determined to be constant. |
| `contradictory-guard` | A guard is inconsistent with the path constraints. |
| `unreachable-dynamic-path` | A dynamic path has no reachable target under the available evidence. |
| `unknown-dynamic-import` | A dynamic import cannot be resolved with the available information. |
| `unresolved-import` | An import could not be resolved. |
| `parse-recovery` | Parsing recovered from a source-level diagnostic. |
| `missing-dependency` | A referenced package is not declared as a dependency. |
| `missing-script-target` | A package script points to a missing target. |
| `unused-dependency` | A declared runtime dependency is not used. |
| `unused-dev-dependency` | A declared development dependency is not used. |
| `non-existent-dependency` | A dependency reference does not resolve to an installed or declared package. |
| `no-entry-points` | No entry point was discovered for the analyzed project. |
| `protected-contract` | A symbol is protected by an external contract or configured public surface. |
| `schema-impossible-guard` | A schema or contract makes a guarded path impossible. |

Confidence values are `high`, `medium`, `low`, and `info`. Severity values are `error`, `warning`, and `info`.

## Automated fixes

Fixes are opt-in and can be used through `analyze()` or the exported `applyFixes()` helper:

```
import { analyze, applyFixes } from "@optiprune/core";

const report = await analyze({
  rootDir: process.cwd(),
  fix: {
    rules: ["files", "exports", "dependencies"],
    confidence: "medium+",
    dryRun: true,
  },
});

const changed = await applyFixes(report, process.cwd(), {
  rules: ["files", "exports", "dependencies"],
  confidence: "medium+",
  dryRun: true,
});

console.log(`planned changes: ${changed}`);
```

Supported fix targets are `files`, `exports`, `dependencies`, `devDependencies`, and `conditions`. `force` allows a selected operation to continue when the source edit is otherwise considered unsafe; `dryRun` reports planned changes without writing them.

## Reporters

The reporters package is available through the `@optiprune/core/reporters` export:

```
import { formatSarif, formatTerminal } from "@optiprune/core/reporters";

const terminalText = formatTerminal(report, { showCycles: true });
const sarifText = formatSarif(report);
```

`formatTerminal()` produces a human-readable report and can include dependency cycles. `formatSarif()` serializes findings to SARIF for CI and code-scanning tools. For a JSON report, serialize the `AnalysisReport` directly.

## Cache API

Core exposes cache utilities for reusing analysis state and moving caches between environments:

```
import {
  exportCache,
  importCache,
  loadCache,
  saveCache,
} from "@optiprune/core";

const cache = loadCache(process.cwd());
saveCache(process.cwd(), cache);
await exportCache(process.cwd(), "./.optiprune/cache.json");
await importCache(process.cwd(), "./.optiprune/cache.json");
```

The cache module also exposes `getFileHash()` and `isCacheValid()` for integrations that need to inspect cache freshness.

## Plugins

Plugins implement the `AnalyzerPlugin` contract and can expose a `PluginAdapter` and lifecycle hooks. Plugins may add entry patterns, mark files or packages as used, interpret project metadata, and participate in file, AST, dependency, or analysis-complete phases.

```
import type { AnalyzerPlugin } from "@optiprune/core/types";

export const ExamplePlugin: AnalyzerPlugin = {
  name: "example-plugin",
  version: "1.0.0",
  detect: async () => true,
  lifecycle: {
    onProjectInit: (adapter) => {
      adapter.addEntryPatterns(["src/index.ts"]);
    },
    onFileStart: (fileId, adapter) => {
      adapter.markAsUsed(fileId);
    },
  },
};
```

The current built-in implementations live in [`src/plugins`](./src/plugins). The plugin registry covers framework, build-tool, test, runtime, package-manager, and workspace conventions.

## Public exports

| Export path | Public surface |
| --- | --- |
| `@optiprune/core` | `analyze`, `shouldFail`, `applyFixes`, `exportCache`, `importCache`, and the main runtime API. |
| `@optiprune/core/reporters` | `formatTerminal`, `formatSarif`. |
| `@optiprune/core/types` | `AnalysisReport`, `AnalyzerOptions`, `Finding`, `FixConfig`, plugin contracts, configuration types, graph types, parser types, and result types. |
| `@optiprune/core/fs-utils` | Filesystem helpers used by integrations that need Core path and file utilities. |

The package also exports `defineConfig`, `CONFIDENCE_RANK`, cache types, report types, module/edge types, monorepo types, and plugin lifecycle types.

## Development

Install dependencies and run the package checks from the repository root:

```bash
npm install
npm run build
npm test
```

The build uses TypeScript. The test suite uses Vitest without file-level parallelism.

## Links

| Resource | Link |
| --- | --- |
| Core repository | [github.com/optiprune/core](https://github.com/optiprune/core) |
| CLI repository | [github.com/optiprune/cli](https://github.com/optiprune/cli) |
| Core package | [npmjs.com/package/@optiprune/core](https://www.npmjs.com/package/@optiprune/core) |
| Documentation site | [opti.drml.int.yt](https://opti.drml.int.yt/) |
| License | [MIT](./LICENSE) |