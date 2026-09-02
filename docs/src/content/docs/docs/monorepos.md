---
title: Monorepos
description: Configure analysis boundaries across packages and workspaces.
---

Run OptiPrune from the workspace root when package relationships should be visible. For isolated package checks, run it from the package directory with that package’s entry points.

## Recommended setup

Keep each package’s public entry points explicit. Include shared build tools and test configuration when they are part of the execution graph.

## Avoid accidental deletion

Do not treat a package as dead merely because another package does not import it. Published packages, CLI entry points, and workspace scripts can be consumed outside the local graph.

Use plugin overrides and ignore lists for generated output, fixtures, and intentional boundary modules.
