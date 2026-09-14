---
title: Configuration
description: Configure roots, rules, plugins, contracts, output, and analysis layers.
---

The loader accepts `optiprune.json`, `optiprune.jsonc`, `optiprune.config.ts`, `optiprune.config.js`, `optiprune.config.mjs`, and the supported package configuration field. CLI values override project configuration.

```ts
import { defineConfig } from "@optiprune/core";

export default defineConfig({
  rootDir: ".",
  entry: ["src/index.ts", "src/worker.ts"],
  extensions: [".ts", ".tsx", ".js", ".jsx", ".vue"],
  ignore: ["**/fixtures/**", "**/generated/**"],
  reportUnusedExports: true,
  includeConventionalEntries: true,
  failOn: "high",
  output: "terminal",
  rules: {
    "unused-export": "warning",
    "unreachable-file": "warning",
    "constant-condition": "warning",
  },
  plugins: {},
  layers: {},
});
```

Use `externalContracts` for public APIs consumed outside the local workspace. Use `ignoreDependencies` for packages intentionally provided by a host. Keep ignores narrow: an overly broad ignore removes evidence from the graph and can hide real problems.

The authoritative machine-readable schema is `schema.json` in the Core repository.
