---
title: Troubleshooting
description: Diagnose incomplete graphs, unexpected findings, and CI failures.
---

## Too many unreachable files

Check the entry points first. Include application boot files, package exports, tests, and scripts that execute in production or CI.

## A dynamic module is reported

Review dynamic imports and dispatch tables. If runtime behavior cannot be proven statically, treat the finding as medium or low confidence and keep it until verified.

## CI fails unexpectedly

Run the exact CI command locally with the same working directory, configuration file, ignore rules, and Node version. Export JSON or SARIF when the terminal output is too abbreviated for debugging.
