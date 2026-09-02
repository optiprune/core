// Calm OptiPrune docs data: the UI presents each source-backed plugin through its user-facing behavior, not implementation internals.
export type PluginRecord = {
  name: string;
  version: string;
  category: string;
  summary: string;
  lifecycle: string[];
  markers: string[];
  source: string;
};

export const plugins: PluginRecord[] = [
  {
    name: "angular-plugin",
    version: "1.3.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Angular conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/angular-plugin.ts",
  },
  {
    name: "astro-plugin",
    version: "1.5.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Astro conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/astro-plugin.ts",
  },
  {
    name: "ava-plugin",
    version: "1.1.0",
    category: "Testing & QA",
    summary:
      "Test-aware analysis for Ava configuration, test files, fixtures, runners, and referenced test helpers.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/ava-plugin.ts",
  },
  {
    name: "babel-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Babel configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/babel-plugin.ts",
  },
  {
    name: "biome-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Biome configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/biome-plugin.ts",
  },
  {
    name: "bumpp-plugin",
    version: "1.1.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Bumpp configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/bumpp-plugin.ts",
  },
  {
    name: "bun-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Bun configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/bun-plugin.ts",
  },
  {
    name: "c8-plugin",
    version: "1.1.0",
    category: "Testing & QA",
    summary:
      "Test-aware analysis for C8 configuration, test files, fixtures, runners, and referenced test helpers.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/c8-plugin.ts",
  },
  {
    name: "capacitor-plugin",
    version: "1.0.0",
    category: "Platforms & runtime",
    summary:
      "Project-aware analysis for Capacitor conventions, configuration, package usage, and reachable source files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/capacitor-plugin.ts",
  },
  {
    name: "changelogen-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Changelogen configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/changelogen-plugin.ts",
  },
  {
    name: "changelogithub-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Changelogithub configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/changelogithub-plugin.ts",
  },
  {
    name: "changesets-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Changesets configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/changesets-plugin.ts",
  },
  {
    name: "commitzen-plugin",
    version: "1.0.0",
    category: "Project conventions",
    summary:
      "Project-aware analysis for Commitizen conventions, configuration, package usage, and reachable source files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/commitzen-plugin.ts",
  },
  {
    name: "commitlint-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Commitlint configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/commitlint-plugin.ts",
  },
  {
    name: "convex-plugin",
    version: "1.0.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Convex conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/convex-plugin.ts",
  },
  {
    name: "cross-env-plugin",
    version: "1.0.1",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Cross Env configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/cross-env-plugin.ts",
  },
  {
    name: "cspell-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Cspell configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/cspell-plugin.ts",
  },
  {
    name: "cucumber-plugin",
    version: "1.0.0",
    category: "Testing & QA",
    summary:
      "Test-aware analysis for Cucumber configuration, test files, fixtures, runners, and referenced test helpers.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/cucumber-plugin.ts",
  },
  {
    name: "cypress-plugin",
    version: "1.0.0",
    category: "Testing & QA",
    summary:
      "Test-aware analysis for Cypress configuration, test files, fixtures, runners, and referenced test helpers.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/cypress-plugin.ts",
  },
  {
    name: "dependency-cruiser-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Dependency Cruiser configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/dependency-cruiser-plugin.ts",
  },
  {
    name: "docker-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Docker configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/docker-plugin.ts",
  },
  {
    name: "docusaurus-plugin",
    version: "1.0.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Docusaurus conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/docusaurus-plugin.ts",
  },
  {
    name: "dotenv-plugin",
    version: "1.1.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Dotenv configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onAnalysisComplete", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/dotenv-plugin.ts",
  },
  {
    name: "drizzle-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Drizzle configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/drizzle-plugin.ts",
  },
  {
    name: "eleventy-plugin",
    version: "1.1.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Eleventy conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/eleventy-plugin.ts",
  },
  {
    name: "esbuild-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Esbuild configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/esbuild-plugin.ts",
  },
  {
    name: "eslint-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Eslint configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/eslint-plugin.ts",
  },
  {
    name: "execa-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Execa configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/execa-plugin.ts",
  },
  {
    name: "expo-plugin",
    version: "1.1.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Expo conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/expo-plugin.ts",
  },
  {
    name: "express-plugin",
    version: "1.1.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Express conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/express-plugin.ts",
  },
  {
    name: "expressive-code-plugin",
    version: "1.1.0",
    category: "Project conventions",
    summary:
      "Project-aware analysis for Expressive Code conventions, configuration, package usage, and reachable source files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/expressive-code-plugin.ts",
  },
  {
    name: "fast-plugin",
    version: "1.0.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Fast conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/fast-plugin.ts",
  },
  {
    name: "fastify-plugin",
    version: "1.1.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Fastify conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/fastify-plugin.ts",
  },
  {
    name: "fumadocs-plugin",
    version: "1.0.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Fumadocs conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/fumadocs-plugin.ts",
  },
  {
    name: "gatsby-plugin",
    version: "1.0.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Gatsby conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/gatsby-plugin.ts",
  },
  {
    name: "graphql-codegen-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Graphql Codegen configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/graphql-codegen-plugin.ts",
  },
  {
    name: "hardhat-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Hardhat configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/hardhat-plugin.ts",
  },
  {
    name: "heroku-plugin",
    version: "1.0.0",
    category: "Project conventions",
    summary:
      "Project-aware analysis for Heroku conventions, configuration, package usage, and reachable source files.",
    lifecycle: ["onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/heroku-plugin.ts",
  },
  {
    name: "hono-plugin",
    version: "1.1.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Hono conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/hono-plugin.ts",
  },
  {
    name: "husky-plugin",
    version: "1.3.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Husky configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/husky-plugin.ts",
  },
  {
    name: "i18next-parser-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for I18Next Parser configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/i18next-parser-plugin.ts",
  },
  {
    name: "jest-plugin",
    version: "1.2.0",
    category: "Testing & QA",
    summary:
      "Test-aware analysis for Jest configuration, test files, fixtures, runners, and referenced test helpers.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/jest-plugin.ts",
  },
  {
    name: "jetbrains-plugin",
    version: "1.0.0",
    category: "Project conventions",
    summary:
      "Project-aware analysis for Jetbrains conventions, configuration, package usage, and reachable source files.",
    lifecycle: ["onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/jetbrains-plugin.ts",
  },
  {
    name: "karma-plugin",
    version: "1.0.0",
    category: "Testing & QA",
    summary:
      "Test-aware analysis for Karma configuration, test files, fixtures, runners, and referenced test helpers.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/karma-plugin.ts",
  },
  {
    name: "knex-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Knex configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/knex-plugin.ts",
  },
  {
    name: "knip-plugin",
    version: "1.0.0",
    category: "Project conventions",
    summary:
      "Project-aware analysis for Knip conventions, configuration, package usage, and reachable source files.",
    lifecycle: ["onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/knip-plugin.ts",
  },
  {
    name: "ladle-plugin",
    version: "1.0.0",
    category: "Testing & QA",
    summary:
      "Test-aware analysis for Ladle configuration, test files, fixtures, runners, and referenced test helpers.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/ladle-plugin.ts",
  },
  {
    name: "lefthook-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Lefthook configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/lefthook-plugin.ts",
  },
  {
    name: "lint-staged-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Lint Staged configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/lint-staged-plugin.ts",
  },
  {
    name: "lint-html-plugin",
    version: "1.0.0",
    category: "Project conventions",
    summary:
      "Project-aware analysis for Linthtml conventions, configuration, package usage, and reachable source files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/lint-html-plugin.ts",
  },
  {
    name: "lit-plugin",
    version: "1.0.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Lit conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/lit-plugin.ts",
  },
  {
    name: "lockfile-lint-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Lockfile Lint configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/lockfile-lint-plugin.ts",
  },
  {
    name: "lost-pixel-plugin",
    version: "1.0.0",
    category: "Project conventions",
    summary:
      "Project-aware analysis for Lost Pixel conventions, configuration, package usage, and reachable source files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/lost-pixel-plugin.ts",
  },
  {
    name: "marko-plugin",
    version: "1.1.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Marko conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/marko-plugin.ts",
  },
  {
    name: "mdx-plugin",
    version: "1.0.0",
    category: "Project conventions",
    summary:
      "Project-aware analysis for Mdx conventions, configuration, package usage, and reachable source files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/mdx-plugin.ts",
  },
  {
    name: "mdxlint-plugin",
    version: "1.0.0",
    category: "Project conventions",
    summary:
      "Project-aware analysis for Mdxlint conventions, configuration, package usage, and reachable source files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/mdxlint-plugin.ts",
  },
  {
    name: "metro-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Metro configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/metro-plugin.ts",
  },
  {
    name: "mocha-plugin",
    version: "1.1.0",
    category: "Testing & QA",
    summary:
      "Test-aware analysis for Mocha configuration, test files, fixtures, runners, and referenced test helpers.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/mocha-plugin.ts",
  },
  {
    name: "moonrepo-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Moonrepo configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/moonrepo-plugin.ts",
  },
  {
    name: "msw-plugin",
    version: "1.1.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Msw configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart"],
    markers: ["markAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/msw-plugin.ts",
  },
  {
    name: "nestjs-plugin",
    version: "1.2.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Nestjs conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/nestjs-plugin.ts",
  },
  {
    name: "netlify-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Netlify configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/netlify-plugin.ts",
  },
  {
    name: "nextjs-plugin",
    version: "1.4.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Nextjs conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/nextjs-plugin.ts",
  },
  {
    name: "nitro-plugin",
    version: "1.2.0",
    category: "Project conventions",
    summary:
      "Project-aware analysis for Nitro conventions, configuration, package usage, and reachable source files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/nitro-plugin.ts",
  },
  {
    name: "node-types-plugin",
    version: "1.1.0",
    category: "Project conventions",
    summary:
      "Project-aware analysis for Node Builtin conventions, configuration, package usage, and reachable source files.",
    lifecycle: ["onASTNode", "onAnalysisComplete", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/node-types-plugin.ts",
  },
  {
    name: "npm-package-json-lint-plugin",
    version: "1.1.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Npm Package Json Lint configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source:
      "https://github.com/optiprune/core/blob/main/src/plugins/npm-package-json-lint-plugin.ts",
  },
  {
    name: "nuxtjs-plugin",
    version: "1.2.0",
    category: "Project conventions",
    summary:
      "Project-aware analysis for Nuxt conventions, configuration, package usage, and reachable source files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/nuxtjs-plugin.ts",
  },
  {
    name: "nx-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Nx configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/nx-plugin.ts",
  },
  {
    name: "nyc-plugin",
    version: "1.0.0",
    category: "Project conventions",
    summary:
      "Project-aware analysis for Nyc conventions, configuration, package usage, and reachable source files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/nyc-plugin.ts",
  },
  {
    name: "object-member-plugin",
    version: "1.1.0",
    category: "Project conventions",
    summary:
      "Project-aware analysis for Object Member conventions, configuration, package usage, and reachable source files.",
    lifecycle: ["onASTNode", "onAnalysisComplete", "onProjectInit"],
    markers: ["emitFinding"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/object-member-plugin.ts",
  },
  {
    name: "oclif-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Oclif configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/oclif-plugin.ts",
  },
  {
    name: "openclaw-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Openclaw configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/openclaw-plugin.ts",
  },
  {
    name: "orval-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Orval configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/orval-plugin.ts",
  },
  {
    name: "oxfmt-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Oxfmt configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/oxfmt-plugin.ts",
  },
  {
    name: "oxlint-plugin",
    version: "1.1.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Oxlint configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onFileStart", "onProjectInit"],
    markers: ["markAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/oxlint-plugin.ts",
  },
  {
    name: "panda-css-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Panda Css configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/panda-css-plugin.ts",
  },
  {
    name: "parcel-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Parcel configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/parcel-plugin.ts",
  },
  {
    name: "payload-cms-plugin",
    version: "1.0.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Payload Cms conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/payload-cms-plugin.ts",
  },
  {
    name: "playwright-plugin",
    version: "1.0.0",
    category: "Testing & QA",
    summary:
      "Test-aware analysis for Playwright configuration, test files, fixtures, runners, and referenced test helpers.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/playwright-plugin.ts",
  },
  {
    name: "plop-plugin",
    version: "1.0.0",
    category: "Project conventions",
    summary:
      "Project-aware analysis for Plop conventions, configuration, package usage, and reachable source files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/plop-plugin.ts",
  },
  {
    name: "pm2-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Pm2 configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/pm2-plugin.ts",
  },
  {
    name: "github-actions-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for GitHub Actions workflows, repository automation, and referenced project files.",
    lifecycle: ["onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/github-actions-plugin.ts",
  },
  {
    name: "pnpm-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Pnpm configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/pnpm-plugin.ts",
  },
  {
    name: "postcss-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Postcss configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/postcss-plugin.ts",
  },
  {
    name: "pre-commit-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Pre Commit configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/pre-commit-plugin.ts",
  },
  {
    name: "preconstruct-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Preconstruct configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/preconstruct-plugin.ts",
  },
  {
    name: "prettier-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Prettier configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/prettier-plugin.ts",
  },
  {
    name: "prisma-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Prisma configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/prisma-plugin.ts",
  },
  {
    name: "quasar-plugin",
    version: "1.0.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Quasar conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/quasar-plugin.ts",
  },
  {
    name: "qwik-plugin",
    version: "1.0.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Qwik conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/qwik-plugin.ts",
  },
  {
    name: "r-tools-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for R Tools configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/r-tools-plugin.ts",
  },
  {
    name: "raycast-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Raycast configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/raycast-plugin.ts",
  },
  {
    name: "react-cosmos-plugin",
    version: "1.0.0",
    category: "Testing & QA",
    summary:
      "Test-aware analysis for React Cosmos configuration, test files, fixtures, runners, and referenced test helpers.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/react-cosmos-plugin.ts",
  },
  {
    name: "react-email-plugin",
    version: "1.0.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for React Email conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/react-email-plugin.ts",
  },
  {
    name: "react-native-plugin",
    version: "1.1.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for React Native conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/react-native-plugin.ts",
  },
  {
    name: "react-native-router-plugin",
    version: "1.1.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for React Native Router configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/react-native-router-plugin.ts",
  },
  {
    name: "react-plugin",
    version: "1.3.1",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for React conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/react-plugin.ts",
  },
  {
    name: "release-it-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Release It configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/release-it-plugin.ts",
  },
  {
    name: "remark-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Remark configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/remark-plugin.ts",
  },
  {
    name: "remix-plugin",
    version: "1.2.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Remix conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/remix-plugin.ts",
  },
  {
    name: "rolldown-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Rolldown configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/rolldown-plugin.ts",
  },
  {
    name: "rollup-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Rollup configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/rollup-plugin.ts",
  },
  {
    name: "rsbuild-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Rsbuild configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/rsbuild-plugin.ts",
  },
  {
    name: "rslib-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Rslib configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/rslib-plugin.ts",
  },
  {
    name: "rspack-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Rspack configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/rspack-plugin.ts",
  },
  {
    name: "rstest-plugin",
    version: "1.0.0",
    category: "Testing & QA",
    summary:
      "Test-aware analysis for Rstest configuration, test files, fixtures, runners, and referenced test helpers.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/rstest-plugin.ts",
  },
  {
    name: "sanity-plugin",
    version: "1.0.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Sanity conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/sanity-plugin.ts",
  },
  {
    name: "semantic-release-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Semantic Release configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/semantic-release-plugin.ts",
  },
  {
    name: "sentry-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Sentry configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/sentry-plugin.ts",
  },
  {
    name: "serverless-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Serverless configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/serverless-plugin.ts",
  },
  {
    name: "service-worker-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Service Worker configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/service-worker-plugin.ts",
  },
  {
    name: "simple-git-hooks-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Simple Git Hooks configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/simple-git-hooks-plugin.ts",
  },
  {
    name: "size-limit-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Size Limit configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/size-limit-plugin.ts",
  },
  {
    name: "sst-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Sst configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/sst-plugin.ts",
  },
  {
    name: "storybook-plugin",
    version: "1.2.0",
    category: "Testing & QA",
    summary:
      "Test-aware analysis for Storybook configuration, test files, fixtures, runners, and referenced test helpers.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/storybook-plugin.ts",
  },
  {
    name: "stryker-plugin",
    version: "1.0.0",
    category: "Testing & QA",
    summary:
      "Test-aware analysis for Stryker configuration, test files, fixtures, runners, and referenced test helpers.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/stryker-plugin.ts",
  },
  {
    name: "stylelint-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Stylelint configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/stylelint-plugin.ts",
  },
  {
    name: "svelte-plugin",
    version: "1.2.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Svelte conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/svelte-plugin.ts",
  },
  {
    name: "svelte-kit-plugin",
    version: "1.2.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Sveltekit conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/svelte-kit-plugin.ts",
  },
  {
    name: "svgo-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Svgo configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/svgo-plugin.ts",
  },
  {
    name: "svgr-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Svgr configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/svgr-plugin.ts",
  },
  {
    name: "swc-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Swc configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/swc-plugin.ts",
  },
  {
    name: "tailwind-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Tailwind configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/tailwind-plugin.ts",
  },
  {
    name: "taskfile-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Taskfile configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onFileStart", "onProjectInit"],
    markers: ["markAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/taskfile-plugin.ts",
  },
  {
    name: "tauri-plugin",
    version: "1.0.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Tauri conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/tauri-plugin.ts",
  },
  {
    name: "temporal-io-plugin",
    version: "1.0.0",
    category: "Project conventions",
    summary:
      "Project-aware analysis for Temporal conventions, configuration, package usage, and reachable source files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/temporal-io-plugin.ts",
  },
  {
    name: "travis-ci-plugin",
    version: "1.2.0",
    category: "Project conventions",
    summary:
      "Project-aware analysis for Travis Ci conventions, configuration, package usage, and reachable source files.",
    lifecycle: ["onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/travis-ci-plugin.ts",
  },
  {
    name: "trpc-plugin",
    version: "1.0.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Trpc conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/trpc-plugin.ts",
  },
  {
    name: "ts-node-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Ts Node configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/ts-node-plugin.ts",
  },
  {
    name: "tsconfig-plus-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Tsconfig Plus configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/tsconfig-plus-plugin.ts",
  },
  {
    name: "tsdown-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Tsdown configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/tsdown-plugin.ts",
  },
  {
    name: "tsup-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Tsup configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/tsup-plugin.ts",
  },
  {
    name: "tsx-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Tsx configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/tsx-plugin.ts",
  },
  {
    name: "typedoc-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Typedoc configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/typedoc-plugin.ts",
  },
  {
    name: "typeorm-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Typeorm configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/typeorm-plugin.ts",
  },
  {
    name: "unbuild-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Unbuild configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/unbuild-plugin.ts",
  },
  {
    name: "unocss-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Unocss configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/unocss-plugin.ts",
  },
  {
    name: "unplugin-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Unplugin configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/unplugin-plugin.ts",
  },
  {
    name: "vercel-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Vercel configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/vercel-plugin.ts",
  },
  {
    name: "vike-plugin",
    version: "1.0.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Vike conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/vike-plugin.ts",
  },
  {
    name: "vite-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Vite configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/vite-plugin.ts",
  },
  {
    name: "vite-specialized-plugin",
    version: "1.3.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Vite Specialized configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/vite-specialized-plugin.ts",
  },
  {
    name: "vitepress-plugin",
    version: "1.0.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Vitepress conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/vitepress-plugin.ts",
  },
  {
    name: "vitest-plugin",
    version: "1.0.0",
    category: "Testing & QA",
    summary:
      "Test-aware analysis for Vitest configuration, test files, fixtures, runners, and referenced test helpers.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/vitest-plugin.ts",
  },
  {
    name: "vscode-plugin",
    version: "1.0.0",
    category: "Project conventions",
    summary:
      "Project-aware analysis for Vscode conventions, configuration, package usage, and reachable source files.",
    lifecycle: ["onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/vscode-plugin.ts",
  },
  {
    name: "vuejs-plugin",
    version: "1.2.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for Vuejs conventions, entrypoints, configuration files, and framework-specific references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/vuejs-plugin.ts",
  },
  {
    name: "webdriver-io-plugin",
    version: "1.0.0",
    category: "Project conventions",
    summary:
      "Project-aware analysis for Webdriverio conventions, configuration, package usage, and reachable source files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/webdriver-io-plugin.ts",
  },
  {
    name: "webpack-plugin",
    version: "1.2.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Webpack configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/webpack-plugin.ts",
  },
  {
    name: "wireit-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Wireit configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/wireit-plugin.ts",
  },
  {
    name: "worker-plugin",
    version: "1.1.0",
    category: "Project conventions",
    summary:
      "Project-aware analysis for Worker conventions, configuration, package usage, and reachable source files.",
    lifecycle: ["onASTNode", "onFileStart"],
    markers: ["markAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/worker-plugin.ts",
  },
  {
    name: "wrangler-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Wrangler configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["emitFinding", "markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/wrangler-plugin.ts",
  },
  {
    name: "xo-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Xo configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/xo-plugin.ts",
  },
  {
    name: "yarn-plugin",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Yarn configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/yarn-plugin.ts",
  },
  {
    name: "zod-plugin",
    version: "2.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Zod configuration, package scripts, generated artifacts, and conventionally used files.",
    lifecycle: ["onASTNode", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/zod-plugin.ts",
  },
  {
    name: "markdown-lint",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Markdown lint configuration, package scripts, and referenced project files.",
    lifecycle: ["onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/markdown-lint.ts",
  },
  {
    name: "nodemon-plugin.",
    version: "1.0.0",
    category: "Tooling & ecosystem",
    summary:
      "Tooling-aware analysis for Nodemon configuration, package scripts, and runtime entry points.",
    lifecycle: ["onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/nodemon-plugin..ts",
  },
  {
    name: "openapi-ts",
    version: "1.0.0",
    category: "Libraries & APIs",
    summary:
      "Project-aware analysis for OpenAPI TypeScript generation configuration and generated API surfaces.",
    lifecycle: ["onASTNode", "onProjectInit"],
    markers: ["markAsUsed", "markPackageAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/openapi-ts.ts",
  },
  {
    name: "tanstack-router",
    version: "1.0.0",
    category: "Frameworks",
    summary:
      "Framework-aware analysis for TanStack Router route trees and generated route references.",
    lifecycle: ["onASTNode", "onFileStart", "onProjectInit"],
    markers: ["markAsUsed", "markAsUsed"],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/tanstack-router.ts",
  },
  {
    name: "graphql-runtime-plugin",
    version: "1.0.0",
    category: "AI & machine learning",
    summary:
      "Recognizes GraphQL runtime usage, schema operations, and package declarations that static imports alone may not explain.",
    lifecycle: [],
    markers: [],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/graphql-runtime-plugin.ts",
  },
  {
    name: "langchainjs-plugin",
    version: "1.0.0",
    category: "AI & machine learning",
    summary:
      "Recognizes LangChain.js imports and runtime chains so model, tool, and loader integrations are assessed in their execution context.",
    lifecycle: [],
    markers: [],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/langchainjs-plugin.ts",
  },
  {
    name: "node-llama-cpp-plugin",
    version: "1.0.0",
    category: "AI & machine learning",
    summary:
      "Understands node-llama-cpp imports and runtime model-sequence usage, including dependency consistency checks.",
    lifecycle: [],
    markers: [],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/node-llama-cpp-plugin.ts",
  },
  {
    name: "onnxruntime-node-plugin",
    version: "1.0.0",
    category: "AI & machine learning",
    summary:
      "Recognizes ONNX Runtime Node sessions and package usage in server-side inference code.",
    lifecycle: [],
    markers: [],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/onnxruntime-node-plugin.ts",
  },
  {
    name: "openapi-plugin",
    version: "1.0.1",
    category: "Libraries & APIs",
    summary:
      "Recognizes OpenAPI specifications and the project packages that consume or generate API contracts from them.",
    lifecycle: [],
    markers: [],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/openapi-plugin.ts",
  },
  {
    name: "tensorflowjs-plugin",
    version: "1.0.0",
    category: "AI & machine learning",
    summary:
      "Recognizes TensorFlow.js runtime imports, tensor lifecycle patterns, and related dependency usage.",
    lifecycle: [],
    markers: [],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/tensorflowjs-plugin.ts",
  },
  {
    name: "transformersjs-plugin",
    version: "1.0.0",
    category: "AI & machine learning",
    summary:
      "Recognizes Transformers.js package usage and inference-oriented calls in JavaScript and TypeScript code.",
    lifecycle: [],
    markers: [],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/transformersjs-plugin.ts",
  },
  {
    name: "vercel-ai-sdk-plugin",
    version: "1.0.0",
    category: "AI & machine learning",
    summary:
      "Recognizes Vercel AI SDK imports and AI generation flows that are meaningful runtime evidence.",
    lifecycle: [],
    markers: [],
    source: "https://github.com/optiprune/core/blob/main/src/plugins/vercel-ai-sdk-plugin.ts",
  },
];
