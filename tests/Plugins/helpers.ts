import { existsSync } from "node:fs";
import path from "node:path";
import { expect } from "vitest";

const aliases: Record<string, string> = {
  next: "nextjs",
  nuxt: "nuxtjs",
  nest: "nestjs",
  "github-action": "github-actions",
  node: "node-types",
  "node-test-runner": "node-types",
  "node-test-reporter": "node-types",
  "node-modules-inspector": "node-types",
  sveltekit: "svelte-kit",
  "sveltekit-monorepo": "svelte-kit",
  "sveltejs-package": "svelte-kit",
  vue: "vuejs",
  "vue-webpack": "webpack",
  vite3: "vite",
  vite4: "vite",
  vite5: "vite",
  "electron-vite": "vite",
  "electron-vite-html": "vite",
  "laravel-vite-plugin": "vite",
  "vite-plus": "vite",
  "vite-rolldown-babel": "vite",
  "vite-plugin-pages": "vite",
  "vite-plugin-pages-custom-dir": "vite",
  "vite-plugin-pwa": "vite",
  "vite-plugin-pwa-nuxt": "vite",
  "vite-plugin-vue-layouts-custom-dir": "vite",
  "vite-plugin-vue-layouts-next": "vite",
  "vite-pwa-assets-generator": "vite",
  typescript2: "typescript",
  "typescript-content-mapper": "typescript",
  tsgo: "typescript",
  "next-intl": "nextjs",
  "next-mdx": "nextjs",
  "next-middleware": "nextjs",
  "next-mixed-routers": "nextjs",
  "next-page-extensions": "nextjs",
  "next-root-and-src": "nextjs",
  "next-subdirectory": "nextjs",
  "nuxt-auto-import-disabled": "nuxtjs",
  "nuxt-auto-import": "nuxtjs",
  "nuxt-config-extends": "nuxtjs",
  "nuxt-config": "nuxtjs",
  "nuxt-layers": "nuxtjs",
  "nuxt-no-root-tsconfig": "nuxtjs",
  "nuxt-shared": "nuxtjs",
  "react-router": "react",
  "tanstack-router": "vite",
  "tanstack-start": "vite",
  starlight: "astro",
  catalyst: "fast",
  stencil: "fast",
  temporal: "workflow",
  travis: "github-actions",
  yorkie: "simple-git-hooks",
  "postcss-tailwindcss": "postcss",
  "postcss-tailwindcss2": "postcss",
  "postcss-tailwindcss3": "postcss",
  "husky-v9-1": "husky",
  "xo-0": "xo",
  "husky-v8": "husky",
  "husky-v9": "husky",
  "lefthook-v1": "lefthook",
  "markdownlint-cli2": "markdownlint",
  "node-test-runner-c8": "node-types",
  "unplugin-vue-components-vue2": "unplugin-vue-components",
};

export function resolvePackagePluginName(testName: string): string {
  const baseName = testName.replace(/(?:-\d+|\d+)$/, "");
  const exactName = aliases[testName] ?? testName;
  const basePackageName = aliases[baseName] ?? baseName;
  const exactFile = path.resolve(process.cwd(), "src/plugins", exactName + "-plugin.ts");
  return existsSync(exactFile) ? exactName : basePackageName;
}

export function assertPackagePlugin(testName: string): void {
  const packageName = resolvePackagePluginName(testName);
  const pluginFile = path.resolve(process.cwd(), "src/plugins", packageName + "-plugin.ts");
  expect(
    existsSync(pluginFile),
    "Expected dedicated plugin file for " + packageName + ": " + pluginFile,
  ).toBe(true);
}
