---
title: Getting started
description: Install OptiPrune and run your first safe analysis.
---

OptiPrune builds a dependency graph from your TypeScript and JavaScript entry points. It reports unreachable files, imports, exports, packages, and logic with confidence levels so cleanup stays reviewable.

## Install

```bash
npm install --save-dev @optiprune/cli
npm install @optiprune/core
```

## Run a dry run

Start without modifying files:

```bash
npx optiprune ./src --entry src/index.ts --dry-run
```

Review high-confidence findings first. Only enable mutation after the report matches your project conventions.

## What to read next

- [Workflow](/docs/workflow/): the recommended scan, review, and fix loop.
- [Configuration](/docs/configuration/): entry points, plugin overrides, and CI thresholds.
- [Plugins](/docs/plugins/): framework and tooling awareness.
