---
title: Architecture
description: How Core turns source files into an evidence-backed graph.
---

OptiPrune separates project discovery, graph construction, analysis layers, reporting, and mutation. The **Core API** owns analysis; the **CLI package** supplies a command-line boundary around it.

## Pipeline

1. **Resolve configuration.** Core loads supported project configuration and combines it with explicit analyzer options.
2. **Discover the workspace.** It resolves the root, package boundaries, conventional entries, configured entries, project files, and workspace relationships.
3. **Run early plugins.** Enabled plugins can inspect project markers and contribute entry patterns, ignore patterns, project files, package usage, and contracts before the full graph is finalized.
4. **Parse source files.** JavaScript and TypeScript modules are parsed and represented with exports, dependency edges, dynamic-import information, diagnostics, and parser status.
5. **Build evidence graphs.** Core connects file, package, symbol, export, workspace, and strongly connected-component relationships.
6. **Analyze reachability and logic.** The analysis layers evaluate imports, exports, members, dependencies, dynamic paths, control flow, contracts, and confidence.
7. **Run the later plugin pass.** Plugins receive file-start events, AST nodes, and the completed graph so framework and runtime conventions can add evidence or findings.
8. **Assemble a report.** Core returns an `AnalysisReport` with modules, findings, summary data, components, entry points, and enabled plugins.
9. **Format or mutate explicitly.** Callers can format the report as terminal or SARIF output, and fixes require an explicit, confidence-gated request.

## Plugin lifecycle

The engine registers built-in and dynamically loaded plugins, runs `detect()` unless configuration overrides the decision, then invokes lifecycle hooks in this order:

```text
detect(adapter)
  ↓
onProjectInit(adapter)
  ↓
for each discovered file: onFileStart(fileId, adapter)
  ↓
for each AST node: onASTNode(node, fileId, adapter, ancestors)
  ↓
onAnalysisComplete(adapter)
```

The engine performs an early project/plugin pass and a later execution pass after source discovery. This lets a framework plugin influence the set of entries while still observing concrete files and AST nodes later. See [Plugins](/docs/plugins/) and [Writing a plugin](/docs/plugin-authoring/) for the adapter contract.

## Evidence and uncertainty

A normal import edge is only one kind of evidence. Plugins can represent generated routes, test discovery, package export maps, configuration contracts, dynamic registries, and externally consumed symbols. Unknown dynamic imports remain uncertain rather than being silently treated as unreachable. Findings carry severity, confidence, source information, and evidence so integrations can choose their own policy.

## CLI boundary

The CLI invokes the same Core concepts through `@optiprune/cli` and exposes command-line options for entries, formats, thresholds, cache, plugins, and fixes. It does not define a second analyzer. For an application-owned integration, install `@optiprune/core` and call `analyze()` directly; for a standard developer or CI command, install `@optiprune/cli` and run `npx @optiprune/cli analyze`.
