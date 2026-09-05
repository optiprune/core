---
title: Plugins
description: How Core understands framework, tooling, runtime, and workspace conventions.
---

A generic import graph cannot know that a framework discovers routes, a test runner loads files by pattern, a bundler consumes configuration, or a package manager exposes a binary. OptiPrune plugins add that project context as explicit graph evidence.

## What a plugin can do

A plugin can recognize project markers, add carefully scoped entry patterns, interpret package metadata, mark files or packages as used, inspect AST and dependency information, and contribute findings during the analysis-complete phase. Plugins should not mutate source files or silently convert uncertainty into reachability.

The repository ships dedicated source plugins under `src/plugins` across frameworks, build tools, testing, package management, runtime conventions, documentation tools, workspace orchestration, and compiler integrations. The [Plugin Explorer](/plugins) is generated from the current directory and links each card to its source file.

## One package, one plugin file

Each package integration has one stable source module named `<package>-plugin.ts`. Test variants are not plugin names: `vite.test.ts`, `vite2.test.ts`, and `vite3.test.ts` all exercise `src/plugins/vite-plugin.ts`; likewise, `vitest8.test.ts` resolves to `src/plugins/vitest-plugin.ts`. A numbered plugin filename must not be added merely because a regression test has a numbered suffix. The production naming audit in `tests/Plugins/plugin-naming.test.ts` checks both duplicate numbered source files and every numbered test variant.

Compiler ownership follows the same rule. Tailwind behavior belongs in `tailwind-plugin.ts`, while Less, Sass/SCSS, Stylus, TSRX, and manually configured compilers each have their own dedicated plugin module. Prisma and Marko compiler behavior remains in their existing package plugins. Do not recreate a generic registry that combines unrelated package behavior in one file.

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

Every plugin should have a fixture that proves its positive behavior, a negative case where the project marker is absent, and a regression case for a previous false positive. The `tests/Plugins` folder also contains package-variant contract tests that verify stable base-plugin naming. The plugin authoring guide covers the `AnalyzerPlugin` contract and adapter boundaries.
