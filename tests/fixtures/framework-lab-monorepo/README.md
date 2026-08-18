# Framework Lab Monorepo

This repository is a **truth-grounded, intentionally noisy framework fixture**. It is designed for dependency graphs, dead-code detection, circular-import analysis, build-tool discovery, documentation indexing, and CI parser testing. It is not intended to be a clean production starter.

## Ground truth

Every technology named in the brief is represented below. “Used” means there is a tracked config, source import, script, or generated artifact that refers to the tool. Some integrations are deliberately minimal and some are intentionally unreachable.

| Technology | Location | Ground-truth usage | Intentional caveat |
|---|---|---|---|
| Bun | `bunfig.toml`, root scripts | Package manager and command runner | Lockfile is omitted intentionally |
| UnoCSS | `packages/ui/uno.config.ts` | Vite plugin configuration | No production CSS extraction |
| unplugin | `packages/ui/vite.config.ts` | Custom virtual-module plugin | Virtual module is unused |
| unbuild | `packages/core/build.config.ts` | Library build configuration | Build output is disposable |
| esbuild | `scripts/esbuild.mjs` | Bundles a fixture entry point | Bundle is not imported by apps |
| webpack | `packages/webpack-fixture/webpack.config.cjs` | Compiles a circular fixture | This package is not in the default build |
| Vite | `packages/ui/vite.config.ts` | UI package build | Storybook owns its own Vite process |
| Storybook | `.storybook/`, `packages/ui/src/Button.stories.tsx` | Component story and config | Story is not covered by Mocha |
| GitHub Actions | `.github/workflows/ci.yml` | CI commands | Workflow is not run in this sandbox |
| Next.js | `apps/next-app/next.config.mjs`, `apps/next-app/app/page.tsx` | App Router page | App is a fixture only |
| NestJS | `apps/nest-api/src/main.ts` | Minimal bootstrap and controller | Server is not started automatically |
| Mocha | `.mocharc.json`, `test/` | Unit tests | One skipped test is intentional |
| Zod | `packages/core/src/schema.ts` | Runtime config parsing | Invalid branch is dead code |
| GraphQL | `apps/nest-api/src/graphql.ts` | Schema and resolver text | Resolver is not wired to Nest transport |
| Docker | `Dockerfile`, `docker-compose.yml` | Container fixture | Compose service is intentionally incomplete |
| Docusaurus | `docs/`, `docusaurus.config.ts` | Documentation site | Docs contain fixture-only statements |
| c8 | root `coverage` script | Coverage wrapper for Mocha | Coverage threshold is not enforced |
| Marko | `apps/marko-app/src/index.marko` | Marko component fixture | Not included in TypeScript build |
| oxlint | `.oxlintrc.json`, root `lint` | Lint configuration and script | Intentional dead code creates findings |
| oxfmt | `.oxfmtrc.json`, root `format` | Formatter configuration and script | Check is expected to fail on some fixtures |
| Biome | `biome.json`, root `lint` | Formatting/lint configuration | Coexists intentionally with oxlint/oxfmt |
| OpenAPI | `openapi/openapi.yaml`, `scripts/validate-openapi.mjs` | API contract and validator script | Contract includes an unused schema |

## Workspace map

| Area | Purpose |
|---|---|
| `packages/core` | Zod schema, build config, circular module pair, dead exports |
| `packages/ui` | React component, UnoCSS, Vite, unplugin, Storybook |
| `packages/webpack-fixture` | Webpack circular-dependency fixture |
| `apps/next-app` | Next.js App Router shell |
| `apps/nest-api` | NestJS bootstrap plus GraphQL/OpenAPI-adjacent API fixture |
| `apps/marko-app` | Marko component fixture |
| `docs` | Docusaurus site |
| `test` | Mocha/c8 tests |
| `scripts` | esbuild and OpenAPI validation fixtures |

## Source-to-dist traps

Each publishable-looking workspace declares `main: dist/index.js`, `module: dist/index.mjs`, and `types: dist/index.d.ts`, but no `dist/` directory is committed. This is intentional: the package metadata describes compiler output, not current source-tree contents. The per-workspace `tsconfig.json` files correctly set `rootDir` to `src` and `outDir` to `dist`; analyzers should therefore report the missing entrypoint as a prebuild condition rather than assuming the source entry is misconfigured. The root `tsconfig.json` carries the same mapping for a conventional root `src` tree, while excluding workspace folders.

## Intentional defects and noise

The fixture intentionally contains unused dependencies, unused devDependencies, unused files, unused members, unused exports, an unreachable branch, a skipped test, a generated-but-unconsumed bundle, and circular dependencies in both TypeScript and Webpack fixtures. These are documented test data, not accidental defects.

The main cycles are `packages/core/src/cycle-a.ts -> cycle-b.ts -> cycle-a.ts` and `packages/webpack-fixture/src/alpha.js -> beta.js -> alpha.js`. The files `packages/core/src/dead-code.ts`, `packages/core/src/unused.ts`, `packages/ui/src/UnusedPanel.tsx`, and `apps/next-app/app/unused-page.tsx` are intentionally not imported.

## Expected validation

After installing with Bun, `bun test` should pass while reporting one skipped test. `bun run coverage` should produce c8 output. `bun run build` exercises unbuild, and `bun run openapi` validates the contract. Lint and format commands may report the deliberately planted findings; that behavior is part of the fixture’s ground truth.

## Safety note

No script downloads or executes remote code. Docker and CI files are inert descriptors. The repository is safe to inspect, index, parse, and run locally.
