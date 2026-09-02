---
title: Architecture
description: How Core turns source files into an evidence-backed graph.
---

OptiPrune separates discovery, graph construction, analysis layers, reporting, and mutation. This keeps the analyzer useful as a library and makes CLI output deterministic.

## Pipeline

1. Resolve workspace boundaries and entry points.
2. Parse JavaScript and TypeScript source files.
3. Build file, package, symbol, and topology relationships.
4. Run enabled plugins against project conventions.
5. Assign confidence and produce JSON, SARIF, or terminal output.
6. Apply changes only when an explicit fix command is requested.

The Core API is headless: callers can provide their own CLI, editor integration, or CI orchestration.
