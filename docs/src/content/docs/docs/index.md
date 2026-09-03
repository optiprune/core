---
title: OptiPrune documentation
description: A clear path from first scan to safe cleanup.
template: splash
hero:
  title: Prove what your code uses.
  tagline: Install, configure, and integrate OptiPrune with a reviewable workflow.
  actions:
    - text: Get started
      link: /docs/getting-started/
      icon: right-arrow
    - text: Browse plugins
      link: /plugins
      icon: external
---

OptiPrune builds a real dependency graph for TypeScript and JavaScript workspaces, then reports unreachable code with context and confidence. It is designed to help you **inspect first and prune deliberately**, rather than deleting code based on naming conventions or guesswork.

## Choose your entry point

| If you want to… | Start here |
| --- | --- |
| Run a scan in a project or CI | [Install the CLI](/docs/cli/) |
| Embed analysis in another tool | [Use the Core API](/docs/headless-api/) |
| Understand findings and confidence | [Read the output reference](/docs/output/) and [confidence guide](/docs/confidence/) |
| Tune roots, rules, and plugins | [Configure OptiPrune](/docs/configuration/) |
| Bring diagnostics into your editor | [Use the language server](/docs/language-server/) or visit the [VS Code extension](https://marketplace.visualstudio.com/items?itemName=optiprune.vscode) |

## The recommended workflow

### 1. Install and scan

```bash
npm install --save-dev @optiprune/cli
npx @optiprune/cli analyze
```

The CLI discovers the project configuration, builds the module graph from the configured entry points, and prints findings for files, imports, exports, packages, and unreachable logic.

### 2. Review before changing code

Every finding includes a rule, severity, confidence, message, file, and—when available—source location or supporting evidence. Use the [output reference](/docs/output/) to understand terminal, JSON, and SARIF reports before making a change.

### 3. Apply only deliberate fixes

Fixes are opt-in. Start with a dry run, set an appropriate confidence threshold, and keep the resulting diff under review. The [fixes guide](/docs/fixes/) documents supported targets such as files, exports, dependencies, and impossible conditions.

## Core concepts

OptiPrune combines reachability analysis, control-flow reasoning, dynamic-import handling, package metadata, and project conventions. The [architecture overview](/docs/architecture/) explains how those layers cooperate; [monorepo guidance](/docs/monorepos/) covers workspaces and cross-package imports.

## Official links

| Resource | Link |
| --- | --- |
| GitHub organisation | [github.com/optiprune](https://github.com/optiprune) |
| Core repository | [github.com/optiprune/core](https://github.com/optiprune/core) |
| CLI package | [@optiprune/cli on npm](https://www.npmjs.com/package/@optiprune/cli) |
| Core package | [@optiprune/core on npm](https://www.npmjs.com/package/@optiprune/core) |
| VS Code extension | [OptiPrune on Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=optiprune.vscode) |

> When in doubt, run a dry scan, inspect the evidence, and treat automated fixes as a proposed change—not as a substitute for review.
