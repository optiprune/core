---
title: Reachability
description: Understand what it means for code to be reachable.
---

A module is reachable when the configured entry points can reach it through imports, exports, dynamic imports, package conventions, or plugin-provided evidence.

## Entry points matter

A scan without accurate entry points can report valid code as unused. Start with application, package, test, and tool entry points that actually execute in your workspace.

## Dynamic behavior

Dynamic dispatch, `getattr`, dispatch tables, `exec`, and `eval` reduce certainty. OptiPrune keeps those cases visible and lowers confidence instead of pretending the graph is complete.

## Generated code

Generated directories should be declared in configuration or ignored deliberately. Do not delete generated output based on a source-only scan.
