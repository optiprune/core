---
title: Quick reference
description: The current CLI flags, Core functions, and configuration fields.
---

## CLI flags

| Flag                          | Purpose                                       |
| ----------------------------- | --------------------------------------------- |
| `-r, --rootDir <path>`        | Choose the project directory.                 |
| `-e, --entry <patterns...>`   | Set entry files, paths, or glob patterns.     |
| `-x, --extensions <exts...>`  | Replace source extensions.                    |
| `-i, --ignore <patterns...>`  | Exclude matching paths.                       |
| `--no-report-unused-exports`  | Disable unused-export findings.               |
| `--no-conventional-entries`   | Disable inferred conventional entries.        |
| `--include-entry-exports`     | Include exports declared directly in entries. |
| `--cycles`                    | Print dependency cycles.                      |
| `--ignore-tests`              | Ignore test files and directories.            |
| `--ignore-unknown-import`     | Do not retain uncertain dynamic-import paths. |
| `--fail-on <confidence>`      | Exit non-zero at the selected confidence.     |
| `--json` / `--sarif`          | Select structured JSON or SARIF output.       |
| `--skip-3` / `--skip-4`       | Skip the SMT or concolic proof pass.          |
| `-v, --verbose`               | Include diagnostics and graph details.        |
| `--fix <rules...>`            | Select explicit fix targets.                  |
| `--fix-json`                  | Repair recoverable package JSON syntax.       |
| `--confidence <level>`        | Set the minimum confidence for fixes.         |
| `--force`                     | Allow an otherwise unsafe selected fix.       |
| `--dry-run`                   | Show planned fixes without writing files.     |
| `--cache-from` / `--cache-to` | Import or export a cache file.                |

## Core functions

The headless package exports `analyze(options)`, `shouldFail(report, failOn)`, `applyFixes(report, rootDir, fixConfig)`, `exportCache(rootDir, targetPath)`, and `importCache(rootDir, sourcePath)`. Reporters are available from `@optiprune/core/reporters`.
