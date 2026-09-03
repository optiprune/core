---
title: Writing a plugin
description: Extend Core with narrow, evidence-producing project conventions.
---

A plugin teaches Core how a framework, build tool, test runner, package manager, runtime, or workspace convention affects reachability. A plugin contributes **evidence** to the graph; it should not hide uncertain code or edit source files.

## The plugin contract

A plugin is an `AnalyzerPlugin` object with a stable `name`, a `version`, an optional asynchronous `detect()` function, and a `lifecycle` object. The lifecycle hooks are optional, so a small plugin can implement only the phase it needs.

```ts
import type { AnalyzerPlugin } from "@optiprune/core/types";

export const ExamplePlugin: AnalyzerPlugin = {
  name: "example-plugin",
  version: "1.0.0",

  async detect(adapter) {
    const packageJson = await adapter.readJson("package.json");
    return Boolean(packageJson?.dependencies?.["example-framework"]);
  },

  lifecycle: {
    async onProjectInit(adapter) {
      adapter.addEntryPatterns(["src/register.ts"]);
      adapter.markPackageAsUsed("example-framework");
    },
  },
};
```

The example is intentionally conservative: it activates only when its project marker is present, adds one known entry pattern, and records the package as used.

## How the lifecycle works

Core runs plugins in an early pass and a later pass after source discovery. The practical order is:

| Phase                  | Hook                                          | Typical responsibility                                                                                        |
| ---------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Detection              | `detect(adapter)`                             | Inspect package metadata, config files, or folders and return whether the plugin applies.                     |
| Project initialization | `onProjectInit(adapter)`                      | Add entries, project/config patterns, ignore rules, protected exports, package usage, or repository metadata. |
| File start             | `onFileStart(fileId, adapter)`                | React to each discovered file and mark framework-consumed files as used.                                      |
| AST traversal          | `onASTNode(node, fileId, adapter, ancestors)` | Inspect syntax and record runtime or configuration contracts.                                                 |
| Completion             | `onAnalysisComplete(adapter)`                 | Emit findings or perform analysis that needs the complete graph.                                              |

When no `detect()` hook exists, the plugin is enabled by default. A repository configuration can override detection with `plugins: { "example-plugin": true }` or disable it with `false`.

## The adapter boundary

Plugins communicate with Core through `PluginAdapter`, rather than reaching into internal state. Read operations include `getAst`, `getSymbol`, `getType`, `getDependencies`, `isPublicExport`, `isEntryPoint`, `isDynamicallyImported`, `getConfig`, `readFile`, `readJson`, `folderExists`, `findFiles`, and `findFilesByGlob`.

Evidence and configuration operations include:

| Adapter method                                      | Purpose                                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| `emitFinding(finding)`                              | Add a plugin finding with severity, confidence, file, message, and evidence. |
| `markAsUsed(fileId, symbol?)`                       | Keep a file or symbol reachable because a convention consumes it.            |
| `markRelativeFileAsUsed(sourceFileId, path)`        | Mark a referenced file relative to the declaring file.                       |
| `markPackageAsUsed(name)`                           | Record package usage that is not visible as a normal import.                 |
| `markConfigMemberAsUsed(file, object, member)`      | Preserve configuration members consumed by a tool.                           |
| `addEntryPatterns(patterns)`                        | Add framework-discovered entry files.                                        |
| `addProjectPatterns(patterns)`                      | Declare configuration or project files in scope.                             |
| `addIgnorePatterns(patterns)`                       | Add framework-specific ignore patterns.                                      |
| `addUnreachableFileIgnorePatterns(patterns)`        | Exclude known generated/contract files from unreachable-file findings.       |
| `addProtectedExportPatterns(patterns)`              | Protect externally consumed exports.                                         |
| `addExternalContracts(names)`                       | Record symbols consumed outside the static graph.                            |
| `setWorkspaceGlobs(patterns)` / `setRepoType(type)` | Contribute workspace classification.                                         |
| `declareFramework(name)`                            | Declare a verified framework for overlap-aware behavior.                     |

Use `emitFinding()` only when the plugin has a specific, explainable diagnostic. Include evidence that makes the result reviewable and choose confidence honestly.

## Static configuration parsing

When a plugin needs project configuration, prefer the static helpers in `plugin-config.ts`. `loadStaticPluginConfig()` reads JSON/JSONC and supported exported configuration objects without executing arbitrary project code. It can also read a plugin-owned key from `package.json`. Use `stringArray()` and `stringRecord()` to validate common shapes.

## Registration and distribution

Built-in plugins live under [`src/plugins`](https://github.com/optiprune/core/tree/main/src/plugins). Core discovers plugin modules from the project’s configured plugin registry during analysis. A plugin should therefore be exported through the registry mechanism used by the repository and included in the published build; merely creating an unreferenced TypeScript file does not make it available to users.

Before publishing a plugin, confirm how the target version loads dynamic plugins and test it through the same configuration path used by the CLI. Keep the plugin package and its compatibility assumptions documented.

## Testing checklist

Create a focused fixture for every convention. The fixture should cover a positive marker, the files or symbols that the plugin preserves, and at least one negative case where the marker is absent. Add a regression case for every false positive. Run both the Core test suite and a real CLI scan, and verify that disabling the plugin removes only the evidence supplied by that plugin.

A good plugin is narrow, deterministic, explainable, and safe when its marker is absent. Prefer a small adapter contribution over framework-specific logic spread through the analyzer.
