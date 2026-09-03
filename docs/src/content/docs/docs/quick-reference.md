---
title: Quick reference
description: The current CLI flags, Core functions, and configuration fields.
---

## CLI flags

| Flag                          | Purpose                                                    |
| ----------------------------- | ---------------------------------------------------------- |
| `-r, --rootDir <path>`        | Choose the project directory.                              |
| `-e, --entry <patterns...>`   | Set entry files, paths, or glob patterns.                  |
| `-x, --extensions <exts...>`  | Replace source extensions.                                 |
| `-i, --ignore <patterns...>`  | Exclude matching paths.                                    |
| `--no-report-unused-exports`  | Disable unused-export findings.                            |
| `--no-conventional-entries`   | Disable inferred conventional entries.                     |
| `--include-entry-exports`     | Include exports declared directly in entries.              |
| `--include-entry-members`     | Include members declared in entry exports.                 |
| `--cycles`                    | Print dependency cycles.                                   |
| `--ignore-tests`              | Ignore test files and directories.                         |
| `--ignore-unknown-import`     | Do not retain uncertain dynamic-import paths.              |
| `--fail-on <confidence>`      | Exit non-zero at the selected confidence.                  |
| `--json` / `--sarif`          | Select structured JSON or SARIF output.                    |
| `--skip <layers...>`          | Skip layers `3`, `4`, or `smt`; `smt` also skips `3`.      |
| `-v, --verbose`               | Include diagnostics and graph details.                     |
| `--fix <rules...>`            | Select explicit fix targets.                               |
| `--fix-json`                  | Repair recoverable package JSON syntax.                    |
| `--plugins <names...>`        | Force-enable built-in plugins such as `astro vite vitest`. |
| `--confidence <level>`        | Set the minimum confidence for fixes.                      |
| `--force`                     | Allow an otherwise unsafe selected fix.                    |
| `--dry-run`                   | Show planned fixes without writing files.                  |
| `--cache-from` / `--cache-to` | Import or export a cache file.                             |

For the complete programmatic API, see the [Core API reference](/docs/headless-api/). The quick reference intentionally avoids duplicating that page.
