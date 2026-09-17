---
title: Language server
description: Publish Core findings as editor diagnostics over LSP.
---

The `@optiprune/language-server` package provides a lightweight Language Server Protocol integration over standard input and output. It detects the workspace from `rootUri` or workspace folders, runs Core, and publishes findings with rule code, severity, confidence, location, and message.

```bash
npm install @optiprune/language-server
npx optiprune-language-server --stdio
```

The server reacts to document open, change, and save events and reuses the normal `.optiprune/cache.json` cache. A client starts it as a stdio process with `npx optiprune-language-server --stdio`.
