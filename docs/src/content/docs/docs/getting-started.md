---
title: Getting started
description: Install OptiPrune and run your first safe analysis.
---

OptiPrune is a static code analyzer for TypeScript and JavaScript workspaces. It builds a graph from real entry points, package metadata, exports, dependencies, and project conventions, then returns findings with evidence and confidence.

## Install the CLI

```bash
npm install --save-dev @optiprune/cli
```

Run the current CLI entry point from the workspace root:

```bash
npx @optiprune/cli analyze
```

## Install Core for integrations

```bash
npm install @optiprune/core
```

Use Core directly when the integration needs a structured report, custom reporter, editor diagnostic, dashboard, or approval workflow.

## Establish a safe baseline

Start with an explicit entry point and a dry run. The command reports planned changes without modifying files:

```bash
npx @optiprune/cli analyze --entry src/index.ts --dry-run
```

If your application has several roots, repeat `--entry` or pass multiple patterns. Review high-confidence findings first, then add configuration for generated files, external contracts, and framework conventions.

## Continue

Read [Quickstart](/docs/quickstart/) for a five-minute workflow, [Output](/docs/output/) for report formats, [Configuration](/docs/configuration/) for schema-backed settings, and [Headless Core API](/docs/headless-api/) for programmatic integrations.
