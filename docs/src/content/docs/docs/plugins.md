---
title: Plugins
description: Framework, test-runner, and tooling conventions supported by Core.
---

OptiPrune discovers plugins from the current Core source tree and uses them to understand conventions that a generic module graph cannot infer.

The [full plugin explorer](/plugins) provides search, category filters, and source links for every shipped plugin.

## Plugin lifecycle

A plugin can participate during project initialization, file discovery, AST analysis, or analysis completion. Plugins report evidence to the same graph rather than mutating files directly.

## When to override

Use an override when your project has an unusual convention, a generated directory, or a framework integration that automatic detection cannot safely infer. Keep the override in version control and explain it in the project README.
