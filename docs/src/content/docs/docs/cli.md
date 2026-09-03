---
title: CLI
description: Install and run the OptiPrune command-line interface.
---

The **CLI package** is [`@optiprune/cli`](https://www.npmjs.com/package/@optiprune/cli). It is the supported command-line entry point for running the [`@optiprune/core`](https://www.npmjs.com/package/@optiprune/core) analyzer. Install the CLI in the project you want to inspect:

```bash
npm install --save-dev @optiprune/cli
```

## Analyze a project

Run the command from the project root:

```bash
npx @optiprune/cli analyze
```

`analyze` is the default command, so this is equivalent:

```bash
npx @optiprune/cli
```

Use explicit entry points when a project does not use conventional entries:

```bash
npx @optiprune/cli analyze \
  --entry src/index.ts \
  --entry src/worker.ts
```

The CLI discovers configuration, parses supported JavaScript and TypeScript files, builds the dependency graph, runs enabled plugins, and prints a terminal report. The default output is terminal text; use `--json` or `--sarif` for integrations.

## Commands

| Command                     | Purpose                                                   |
| --------------------------- | --------------------------------------------------------- |
| `analyze [options]`         | Analyze the current project. This is the default command. |
| `export-cache <targetPath>` | Export the current analysis cache.                        |
| `import-cache <sourcePath>` | Import an analysis cache before a run.                    |
| `--help`                    | Print command and option help.                            |
| `--version`                 | Print the CLI and detected Core versions.                 |

## Reports and CI

```bash
# Structured JSON for scripts
npx @optiprune/cli analyze --json

# SARIF for code-scanning tools
npx @optiprune/cli analyze --sarif > optiprune.sarif

# Fail when high-confidence findings exist
npx @optiprune/cli analyze --fail-on high
```

The terminal reporter begins with `Optiprune Analysis Report`, followed by the root, a summary, and findings grouped by file. Each finding includes a rule, message, and—when a source location exists—confidence. See [Output](/docs/output/) for the exact format and [Reporters](/docs/reporters/) for Core-level formatting functions.

## Configuration and scope

The CLI accepts project configuration from `optiprune.json`, `optiprune.jsonc`, `optiprune.config.ts`, `optiprune.config.js`, `optiprune.config.mjs`, or the `package.json#optiprune` field. See [Configuration](/docs/configuration/) for precedence and examples.

Common options include:

| Option                      | Meaning                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--rootDir <path>`          | Analyze a different project root.                                                                                                                                  |
| `--entry <patterns...>`     | Add entry-point files or globs.                                                                                                                                    |
| `--extensions <exts...>`    | Set source extensions; the default includes `.ts`, `.tsx`, `.js`, `.jsx`, and `.vue`.                                                                              |
| `--ignore <patterns...>`    | Ignore matching paths.                                                                                                                                             |
| `--no-conventional-entries` | Disable automatic conventional entries such as `src/index.ts`.                                                                                                     |
| `--cycles`                  | Include dependency-cycle information in human-readable output.                                                                                                     |
| `--ignore-tests`            | Exclude conventional test files.                                                                                                                                   |
| `--ignore-unknown-import`   | Ignore uncertain dynamic-import paths.                                                                                                                             |
| `--verbose`                 | Include additional analyzer diagnostics.                                                                                                                           |
| `--plugins <names...>`      | Force-enable built-in plugins, for example `astro vite vitest`; the `-plugin` suffix is optional. Unknown names produce a familiar-name suggestion when available. |
| `--fix <rules...>`          | Select fix targets: `files`, `exports`, `dependencies`, `devDependencies`, `conditions`, or `json`.                                                                |
| `--fix-json`                | Safely repair recoverable `package.json` JSON errors.                                                                                                              |
| `--confidence <level>`      | Set the minimum fix confidence: `high`, `medium+`, `low+`, or `all`.                                                                                               |
| `--force`                   | Allow an otherwise unsafe selected fix.                                                                                                                            |
| `--dry-run`                 | Show planned fixes without writing files.                                                                                                                          |
| `--cache-from <path>`       | Import a cache before analysis.                                                                                                                                    |
| `--cache-to <path>`         | Export the resulting cache after analysis.                                                                                                                         |

`--confidence`, `--force`, and `--dry-run` require `--fix` or `--fix-json`. `--plugins` force-enables every requested built-in plugin and preserves other project plugin settings.

## Controlled fixes

Fixes are explicit and confidence-gated. Begin with a dry run:

```bash
npx @optiprune/cli analyze \
  --fix files exports dependencies devDependencies conditions json \
  --confidence medium+ \
  --dry-run
```

Supported fix targets are `files`, `exports`, `dependencies`, `devDependencies`, `conditions`, and safely recoverable `json` changes. Review the proposed diff before running without `--dry-run`; see [Fixes](/docs/fixes/) for safety boundaries.
