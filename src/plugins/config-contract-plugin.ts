import type { AnalyzerPlugin, PluginAdapter } from "../types.js";

import path from "pathe";

const CONFIG_GLOBS = [
  "**/*.{json,js,cjs,mjs,ts,mts,cts,yml,yaml,toml}",
  "**/*config.{js,cjs,mjs,ts,mts,cts,json,yml,yaml}",
  "**/.eslintrc*",
  "**/.babelrc*",
  "**/.prettierrc*",
  "**/.stylelintrc*",
  "**/.markdownlint*",
  "**/{angular,knip,package,tsconfig,webpack,vite,vitest,rollup,postcss,tailwind,svelte,vue,astro,nuxt,playwright,storybook}.json",
  "**/{Taskfile,lerna,turbo,nx}.yml",
];

const PACKAGE_KEYS = new Set([
  "addons",
  "builder",
  "compiler",
  "coverage",
  "framework",
  "integrations",
  "loaders",
  "plugins",
  "presets",
  "provider",
  "reporters",
  "resolvers",
  "runner",
  "serializers",
  "transform",
  "transforms",
  "use",
]);

const declaredDependencies = new WeakMap<PluginAdapter, Set<string>>();

const ENTRY_KEYS = new Set([
  "extends",
  "environment",
  "env",
  "input",
  "main",
  "output",
  "path",
  "preset",
  "assets",
  "entry",
  "entries",
  "files",
  "include",
  "patterns",
  "projects",
  "roots",
  "setupFiles",
  "stories",
  "testMatch",
  "tests",
]);

function isConfigFile(fileId: string): boolean {
  const normalized = fileId.replace(/\\/g, "/");
  const basename = normalized.split("/").at(-1) ?? normalized;
  return (
    basename === "package.json" ||
    basename === "angular.json" ||
    basename.startsWith(".eslintrc") ||
    basename.startsWith(".babelrc") ||
    basename.startsWith(".prettierrc") ||
    basename.startsWith(".stylelintrc") ||
    basename.startsWith(".markdownlint") ||
    basename.includes("config") ||
    basename.endsWith(".rc") ||
    basename.endsWith(".rc.js") ||
    basename.endsWith(".rc.cjs") ||
    basename.endsWith(".rc.json") ||
    basename.endsWith(".rc.yml") ||
    basename.endsWith(".rc.yaml") ||
    /^(Taskfile|lerna|turbo|nx)\.(json|ya?ml)$/.test(basename)
  );
}

function isPackageName(value: string): boolean {
  if (!value || value.startsWith(".") || value.startsWith("/") || value.includes("*")) return false;
  if (/^(https?:|file:|data:|node:)/.test(value)) return false;
  if (
    /^(true|false|null|undefined|development|production|test|warn|error|off|none|default)$/.test(
      value,
    )
  )
    return false;
  if (/^[a-zA-Z]:[\\/]/.test(value)) return false;
  return value.startsWith("@") ? value.includes("/") : /^[a-zA-Z0-9][a-zA-Z0-9._/@-]*$/.test(value);
}

function stringValue(node: any): string | null {
  if (typeof node?.value === "string") return node.value;
  if (typeof node?.extra?.rawValue === "string") return node.extra.rawValue;
  return null;
}

function propertyName(node: any): string | null {
  const key = node?.key;
  if (!key) return null;
  return typeof key.name === "string" ? key.name : stringValue(key);
}

function walk(node: any, visit: (node: any, parent: any) => void, parent: any = null): void {
  if (!node || typeof node !== "object") return;
  visit(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent" || key === "loc" || key === "start" || key === "end") continue;
    if (Array.isArray(value)) for (const child of value) walk(child, visit, node);
    else if (value && typeof value === "object") walk(value, visit, node);
  }
}

function markString(value: string, fileId: string, parent: any, adapter: PluginAdapter): void {
  if (isPackageName(value)) {
    adapter.markPackageAsUsed(value);
    if (!declaredDependencies.get(adapter)?.has(value)) {
      adapter.markMissingDevDependency(
        value,
        fileId,
        `Package '${value}' is referenced by plugin configuration.`,
      );
    }
  }
  if (value.startsWith(".") || value.startsWith("/")) {
    const key = propertyName(parent);
    if (key && ENTRY_KEYS.has(key)) {
      adapter.addEntryPatterns([value]);
      adapter.markRelativeFileAsUsed(fileId, value);
    }
  }
}

export const ConfigContractPlugin: AnalyzerPlugin = {
  name: "config-contract-plugin",
  version: "1.0.0",
  lifecycle: {
    onProjectInit: async (adapter) => {
      const packageJson = await adapter.readJson("package.json");
      const dependencies = new Set([
        ...Object.keys(packageJson?.dependencies ?? {}),
        ...Object.keys(packageJson?.devDependencies ?? {}),
        ...Object.keys(packageJson?.peerDependencies ?? {}),
      ]);
      declaredDependencies.set(adapter, dependencies);
      for (const file of await adapter.findFilesByGlob(CONFIG_GLOBS))
        adapter.markConfigFileAsUsed(file);
    },
    onFileStart: (fileId, adapter) => {
      if (isConfigFile(fileId)) adapter.markConfigFileAsUsed(fileId);
    },
    onAnalysisComplete: async (adapter) => {
      const declared = declaredDependencies.get(adapter) ?? new Set<string>();
      const discoveredFiles = await adapter.findFilesByGlob(CONFIG_GLOBS);
      const configuredFiles = adapter.getConfig().configFiles ?? [];
      const files = Array.from(new Set([...discoveredFiles, ...configuredFiles]));
      const packagePattern = /["'`](@[^"'`/\s]+\/[^"'`/\s]+|[a-zA-Z0-9][a-zA-Z0-9._-]*)["'`]/g;
      for (const file of files) {
        if (
          !isConfigFile(file) &&
          !/(package|app|netlify|codegen|graphql|karma|jest|postcss|tailwind|storybook|vite|vitest|webpack|rollup|eslint|prettier|nuxt|next|angular)/i.test(
            file,
          )
        )
          continue;
        const rootDir = adapter.getConfig().rootDir;
        const relativeFile = path.isAbsolute(file) ? path.relative(rootDir, file) : file;
        const source = await adapter.readFile(relativeFile);
        if (!source) continue;
        for (const match of source.matchAll(packagePattern)) {
          const packageName = match[1];
          if (!packageName) continue;
          if (!isPackageName(packageName) || declared.has(packageName)) {
            if (isPackageName(packageName)) adapter.markPackageAsUsed(packageName);
            continue;
          }
          adapter.markPackageAsUsed(packageName);
          adapter.markMissingDevDependency(
            packageName,
            file,
            `Plugin configuration references '${packageName}'.`,
          );
        }
      }
    },
    onASTNode: (node, fileId, adapter) => {
      if (!isConfigFile(fileId)) return;
      walk(node, (current, parent) => {
        const value = stringValue(current);
        if (!value) return;
        const key = propertyName(parent);
        if (value.startsWith(".") || value.startsWith("/")) {
          adapter.markRelativeFileAsUsed(fileId, value);
          return;
        }
        if (
          PACKAGE_KEYS.has(key ?? "") ||
          ENTRY_KEYS.has(key ?? "") ||
          value.startsWith("@") ||
          /(?:plugin|loader|reporter|config|preset|adapter|provider|serializer|runner)/i.test(value)
        ) {
          markString(value, fileId, parent, adapter);
        }
      });
    },
  },
};

export default ConfigContractPlugin;
