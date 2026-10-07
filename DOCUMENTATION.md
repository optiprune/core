# Optiprune Headless API Documentation

The `@optiprune/core` library provides the core engine for static code analysis of TypeScript and JavaScript workspaces. It is designed as a **Headless API**, meaning it does not enforce terminal output but instead provides structured data that can be integrated into any workflow (CI/CD, custom dashboards, IDE plugins).

## Installation

To use the Headless API in your project, install the core package. As it is an ESM module, it requires a Node.js environment that supports modern ECMAScript features.

```bash
npm install @optiprune/core
```

## Core Functions

The API is primarily controlled through two exported functions defined in `index.ts`.

### 1. `analyze(options: AnalyzerOptions): Promise<AnalysisReport>`

This is the main entry point. The function performs the full analysis process, including AST parsing, graph construction, and the application of various analysis layers (SMT solver, concolic execution).

### 2. `shouldFail(report: AnalysisReport, failOn: Confidence): boolean`

A helper function for CI systems. It checks if the report contains findings with a confidence level that meets or exceeds the specified threshold.

---

## Data Structures

### AnalyzerOptions

The configuration controls the scope and depth of the analysis.

| Option                      | Type       | Description                                                                                                                               |
| --------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `rootDir`                   | `string`   | The root directory of the project (default: `process.cwd()`).                                                                             |
| `entry`                     | `string[]` | Glob patterns for the application's entry points.                                                                                         |
| `extensions`                | `string[]` | File extensions to analyze (default: `.ts`, `.tsx`, `.js`, `.jsx`).                                                                       |
| `reportUnusedExports`       | `boolean`  | Whether to report unused exports.                                                                                                         |
| `sourceMapping`             | `object`   | Reverse-maps compiled build artifacts back to source files. Normally derived from `tsconfig` `outDir`/`rootDir`; see below for overrides. |
| `tagHints`                  | `object`   | Maps JSDoc tag names to `ignore` or `public` semantics.                                                                                   |
| `ignoreTags` / `publicTags` | `string[]` | Additional tag names that exempt an export or member from reporting.                                                                      |
| `verbose`                   | `boolean`  | Enables detailed logging of the analysis process, including Layer 4 sandbox simulation details and resolved paths.                        |
| `skip3` / `skip4`           | `boolean`  | Disables the SMT solver (Layer 3) or concolic execution (Layer 4).                                                                        |

#### Reverse source mapping (`sourceMapping`)

Projects that compile `src/**` into `dist/**` are analyzed through their sources,
but manifests, package scripts and consumers point at the build output. The
mapper translates those references back to source files using the `outDir` and
`rootDir` pairs found in `tsconfig.json` (including `extends` chains) and the
conventional `dist/` → `src/` layout.

| Field                | Type       | Description                                                                                                                                                                            |
| -------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `srcDir`             | `string`   | Source directory, relative to the project root or absolute. Defaults to `src`.                                                                                                         |
| `outDir`             | `string`   | Build output directory, relative to the project root or absolute. Required for the explicit mapping.                                                                                   |
| `sourceExtensions`   | `string[]` | Replaces the standard source extension list.                                                                                                                                           |
| `compilerExtensions` | `string[]` | Extensions handled by a custom compiler, e.g. `.foo`, `.mdx`, `.svelte`. They are probed after the standard source extensions, so they can never shadow a real TypeScript source file. |

All compiled output extensions are recognized, including the JSX variants: a
`dist/index.jsx` artifact maps back to `src/index.tsx`, and a `dist/index.js`
artifact maps back to `src/index.ts`.

### AnalysisReport

The result of the analysis is a detailed object summarizing all insights.

| Field      | Type              | Description                                                     |
| ---------- | ----------------- | --------------------------------------------------------------- |
| `summary`  | `AnalysisSummary` | Statistical summary (number of files, errors, warnings).        |
| `findings` | `Finding[]`       | A list of all discovered issues (dead code, unreachable files). |
| `modules`  | `ModuleRecord[]`  | Raw data about all analyzed modules and their dependencies.     |

---

## Implementation Example

The following example shows how to use `@optiprune/core` in a Node.js script to perform a custom analysis.

```typescript
import { analyze, shouldFail } from "@optiprune/core";
import { formatTerminal } from "@optiprune/core/reporters";

async function runCustomAnalysis() {
  try {
    // 1. Configure analysis
    const report = await analyze({
      rootDir: "./my-project",
      entry: ["src/main.ts"],
      reportUnusedExports: true,
      failOn: "high",
      verbose: true, // Enable detailed logs for debugging dynamic imports
    });

    // 2. Process results
    console.log(`Analysis complete. ${report.summary.findings} issues found.`);

    // 3. Optional: Use the built-in terminal reporter
    if (report.findings.length > 0) {
      console.log(formatTerminal(report));
    }

    // 4. CI/CD Logic
    if (shouldFail(report, "high")) {
      process.exit(1);
    }
  } catch (error) {
    console.error("Error during analysis:", error);
  }
}

runCustomAnalysis();
```

## Advanced Usage: Reporters

Although the API is "headless," `@optiprune/core/reporters` provides helper functions to transform the `AnalysisReport` into common formats:

- **Terminal**: `formatTerminal(report)` generates a colored, human-readable summary.

- **SARIF**: `formatSarif(report)` generates a JSON structure following the _Static Analysis Results Interchange Format_, ideal for GitHub Actions Code Scanning.
