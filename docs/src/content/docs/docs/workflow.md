---
title: Recommended workflow
description: Discover, review, and prune with explicit confidence gates.
---

## 1. Discover

Declare the real application entry points and let OptiPrune build the reachability graph. For monorepos, define workspace boundaries explicitly.

## 2. Review

Treat findings as a review queue. High-confidence findings are the safest starting point; medium and low confidence findings should be checked against dynamic imports, dispatch tables, generated files, and runtime conventions.

## 3. Fix

Use a dry run before mutation. Keep file changes in a separate commit so the analysis result and the cleanup decision remain easy to audit.

```bash
npx optiprune ./src --entry src/index.ts --dry-run
npx optiprune ./src --entry src/index.ts --fail-on high
```

## CI principle

CI should block new high-confidence dead code without silently rewriting a branch. Use JSON or SARIF output when a code-scanning platform consumes the report.
