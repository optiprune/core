---
title: OptiPrune documentation
description: A clear path from first scan to Core integration and plugin development.
template: splash
hero:
  title: Prove what your code uses.
  tagline: Start with the CLI, integrate the Core API, and extend project knowledge with plugins.
  actions:
    - text: Install the CLI
      link: /docs/cli/
      icon: right-arrow
    - text: Learn the Core API
      link: /docs/headless-api/
      icon: external
---

OptiPrune is a static analyzer for TypeScript and JavaScript workspaces. The **CLI** (`@optiprune/cli`) is the ready-to-run command. The **Core API** (`@optiprune/core`) is the programmatic engine underneath it. Plugins add evidence for framework, tooling, runtime, and workspace conventions.

## Choose your path

| If you want to…                                 | Start here                                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Run a scan locally or in CI                     | [CLI](/docs/cli/)                                                                                                                           |
| Embed analysis in an application or integration | [Core API](/docs/headless-api/)                                                                                                             |
| Understand reports and confidence               | [Output](/docs/output/) and [Confidence](/docs/confidence/)                                                                                 |
| Configure entries, rules, and plugins           | [Configuration](/docs/configuration/)                                                                                                       |
| Understand the engine                           | [Architecture](/docs/architecture/)                                                                                                         |
| Build a framework or tool integration           | [Plugins](/docs/plugins/) and [Writing a plugin](/docs/plugin-authoring/)                                                                   |
| Bring diagnostics into an editor                | [Language Server](/docs/language-server/) and the [VS Code extension](https://marketplace.visualstudio.com/items?itemName=optiprune.vscode) |

## Recommended learning route

Start with the [CLI](/docs/cli/) and run one scan. Then read [Output](/docs/output/) to understand the terminal, JSON, and SARIF shapes. If another program should own orchestration or presentation, move to the [Core API](/docs/headless-api/). If the analyzer needs to understand a framework-specific convention, study [how plugins work](/docs/plugins/) before writing a plugin with the [authoring guide](/docs/plugin-authoring/).

## Install the CLI

```bash
npm install --save-dev @optiprune/cli
npx @optiprune/cli analyze
```

## Install the Core API

```bash
npm install @optiprune/core
```

```ts
import { analyze } from "@optiprune/core";

const report = await analyze({
  rootDir: process.cwd(),
  entry: ["src/index.ts"],
});
```

## Official links

| Resource            | Link                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| GitHub organisation | [github.com/optiprune](https://github.com/optiprune)                                                           |
| Core repository     | [github.com/optiprune/core](https://github.com/optiprune/core)                                                 |
| CLI repository      | [github.com/optiprune/cli](https://github.com/optiprune/cli)                                                   |
| CLI package         | [@optiprune/cli on npm](https://www.npmjs.com/package/@optiprune/cli)                                          |
| Core package        | [@optiprune/core on npm](https://www.npmjs.com/package/@optiprune/core)                                        |
| VS Code extension   | [OptiPrune on Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=optiprune.vscode) |
