---
title: Core API
description: Use OptiPrune as a library in custom tooling and automation.
---

OptiPrune Core exposes a headless analysis engine for applications that need more control than the CLI provides.

## Library shape

The engine accepts a workspace context, resolves configuration, loads enabled plugins, and returns structured findings. Reporters can then convert those findings into terminal, JSON, or SARIF output.

## Integration guidance

Keep analysis separate from mutation. A custom editor or dashboard should show the evidence and confidence level first, then request a deliberate fix action from the user.

See the package exports in the repository for the current TypeScript types and reporter interfaces.
