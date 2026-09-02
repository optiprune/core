import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const publicDir = resolve(root, "docs/public");
await mkdir(publicDir, { recursive: true });

const files = (await readdir(resolve(root, "src/plugins")))
  .filter((file) => file.endsWith("-plugin.ts"))
  .sort();
const plugins = files.map((file) => {
  const name = file.replace(/\.ts$/, "");
  const raw = name.replace(/-plugin$/, "").replace(/-/g, " ");
  const label = raw.replace(/\b\w/g, (char) => char.toUpperCase());
  const lower = name.toLowerCase();
  const category =
    /test|ava|c8|cucumber|cypress|jest|mocha|playwright|storybook|stryker|vitest/.test(lower)
      ? "Testing & QA"
      : /next|nuxt|astro|angular|docusaurus|eleventy|express|fastify|hono|remix|svelte|vue|react|solid|nestjs|expo|gatsby|vitepress/.test(
            lower,
          )
        ? "Frameworks"
        : /eslint|biome|babel|webpack|rollup|esbuild|tsup|vite|swc|oxc|typescript|prettier|tailwind|unocss/.test(
              lower,
            )
          ? "Tooling & ecosystem"
          : "Project conventions";
  return {
    name,
    version: "current",
    category,
    summary: `Project-aware analysis for ${label} conventions, configuration, package usage, and reachable source files.`,
    source: `https://github.com/optiprune/core/blob/main/src/plugins/${file}`,
  };
});

await writeFile(resolve(publicDir, "plugins.json"), JSON.stringify(plugins, null, 2));
console.log(`Generated ${plugins.length} plugins in docs/public/plugins.json`);
