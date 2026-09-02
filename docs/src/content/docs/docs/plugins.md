---
title: Plugins
description: How Core understands framework, tooling, runtime, and workspace conventions.
---

A generic import graph cannot know that a framework discovers routes, a test runner loads files by pattern, a bundler consumes configuration, or a package manager exposes a binary. OptiPrune plugins add that project context as explicit graph evidence.

## What a plugin can do

A plugin can recognize project markers, add carefully scoped entry patterns, interpret package metadata, mark files or packages as used, inspect AST and dependency information, and contribute findings during the analysis-complete phase. Plugins should not mutate source files or silently convert uncertainty into reachability.

The repository currently ships 163 source plugins across frameworks, build tools, testing, package management, runtime conventions, documentation tools, and workspace orchestration. The [Plugin Explorer](/plugins) is generated from the current `src/plugins` directory and links each card to its source file.

## Enablement and overrides

Automatic detection is preferred. Set a plugin to `true` to force-enable it or `false` to disable it when a repository uses a nonstandard convention:

```json
{
  "plugins": {
    "nextjs-plugin": true,
    "nestjs-plugin": false
  }
}
```

Keep overrides in version control and explain why they exist. A broad plugin entry pattern can hide real findings, so prefer the smallest pattern that represents the framework contract.

## Testing a plugin

Every plugin should have a fixture that proves its positive behavior, a negative case where the project marker is absent, and a regression case for a previous false positive. The plugin authoring guide covers the `AnalyzerPlugin` contract and adapter boundaries.
