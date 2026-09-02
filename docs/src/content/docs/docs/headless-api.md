---
title: Headless Core API
description: Integrate OptiPrune without the CLI.
---

`@optiprune/core` is the analysis engine behind the CLI. It can run in CI jobs, editor integrations, dashboards, and custom developer tools without installing the CLI package.

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

`analyze()` returns a `Promise<AnalysisReport>`. Keep analysis separate from mutation. Request fixes explicitly with `applyFixes(report, rootDir, fixConfig)` and use `dryRun` plus a confidence gate before writing files.
