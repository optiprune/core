---
title: CLI reference
description: Commands for scanning, reporting, and controlled fixes.
---

## Scan

```bash
npx optiprune <path> --entry <entry-file>
```

## Dry run

```bash
npx optiprune ./src --entry src/index.ts --dry-run
```

## CI threshold

```bash
npx optiprune ./src --fail-on high
```

## Reporters

Use `--reporter json` for automation or `--reporter sarif --output optiprune.sarif` for code-scanning platforms.

## Configuration

Use `--config path/to/optiprune.json` when configuration is not located at the workspace root.
