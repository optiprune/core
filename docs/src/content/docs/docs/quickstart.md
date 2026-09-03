---
title: Quickstart
description: Run a first scan in under five minutes.
---

## Create a baseline

```bash
npm install --save-dev @optiprune/cli
npx optiprune ./src --entry src/index.ts --dry-run
```

## Read the report

Start with unreachable files and high-confidence unused imports. Confirm that your entry points include the application, test runner, and any package exports that are consumed externally.

## Add the check to CI

```bash
npx optiprune ./src --entry src/index.ts --fail-on high --reporter sarif --output optiprune.sarif
```

After the baseline is clean, review medium-confidence findings as a normal engineering task rather than turning them into automatic deletions.
