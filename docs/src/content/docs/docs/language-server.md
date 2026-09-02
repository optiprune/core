---
title: Language server
description: Publish Core findings as editor diagnostics over LSP.
---

The Core package includes a lightweight Language Server Protocol implementation over standard input and output. It detects the workspace from `rootUri` or workspace folders, runs the analyzer, and publishes findings with rule code, severity, confidence, location, and message.

```bash
npm install @optiprune/core
npm run build
npx optiprune-language-server
```

The server reacts to document open, change, and save events and reuses the normal `.optiprune/cache.json` cache. A client starts it as a stdio process with `npx optiprune-language-server`.
