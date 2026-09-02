---
title: Writing a plugin
description: Extend Core with narrow, evidence-producing project conventions.
---

A plugin teaches Core how a framework, tool, test runner, package manager, or workspace convention affects reachability. A good plugin adds evidence; it does not hide uncertain code.

## Responsibilities

A plugin can add entry patterns, interpret project metadata, mark files or packages as used, inspect AST or dependency data, and participate in an analysis-complete phase. Keep the plugin name stable and scope its behavior to the convention it understands.

```ts
import type { AnalyzerPlugin } from "@optiprune/core/types";

export const ExamplePlugin: AnalyzerPlugin = {
  name: "example-plugin",
  async setup(context) {
    context.addEntryPattern("src/register.ts");
  },
};
```

The exact hook surface should follow the current exported types in the repository. Add a focused fixture for every convention, include a false-positive case, and verify that the plugin remains inactive when its project marker is absent.

## Review checklist

A plugin should explain its evidence, avoid broad unconditional entry points, preserve dynamic uncertainty, and be covered by a regression test. Prefer a small adapter over framework-specific behavior spread through the core analyzer.
