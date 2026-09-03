---
title: Cache
description: Reuse analysis state safely across local and CI runs.
---

Core stores a project cache at `<workspace>/.optiprune/cache.json` when enabled. `loadCache()` and `saveCache()` support integrations; `exportCache(rootDir, targetPath)` and `importCache(rootDir, sourcePath)` move compatible cache data between environments.

On unchanged workspaces, Core first compares the analysis key and inexpensive file metadata such as `size` and `mtimeMs`. When metadata is unavailable or different, it falls back to SHA-256 content hashes. Invalidated runs reuse unchanged module records and reparse changed files.

Use `--cache-from` and `--cache-to` in automation when the cache is stored as a CI artifact. Treat caches as performance data, never as the source of truth for findings.
