import { AnalyzerPlugin, PluginAdapter } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const WRANGLER_CONFIG_FILES = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"];

type WranglerConfigInfo = {
  entryPoints: string[];
  bindings: Set<string>;
};

const configState: WranglerConfigInfo & {
  configFiles: Set<string>;
  usedBindings: Map<string, Set<string>>;
} = {
  entryPoints: [],
  bindings: new Set(),
  configFiles: new Set(),
  usedBindings: new Map(),
};

function resetConfigState(): void {
  configState.entryPoints = [];
  configState.bindings.clear();
  configState.configFiles.clear();
  configState.usedBindings.clear();
}

const WRANGLER_SPECIAL_FILES = ["worker-configuration.d.ts", ".dev.vars"];

const CLOUDFLARE_PACKAGES = [
  "wrangler",
  "@cloudflare/workers-types",
  "@cloudflare/vite-plugin",
  "@cloudflare/next-on-pages",
  "@cloudflare/kv-asset-handler",
  "@cloudflare/ai",
];

function parseJsonc<T = any>(content: string): T | null {
  try {
    let cleanJson = "";
    let quote = false;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    for (let index = 0; index < content.length; index += 1) {
      const current = content[index] ?? "";
      const next = content[index + 1] ?? "";
      if (lineComment) {
        if (current === "\\n" || current === "\\r") {
          lineComment = false;
          cleanJson += current;
        }
        continue;
      }
      if (blockComment) {
        if (current === "*" && next === "/") {
          blockComment = false;
          index += 1;
        }
        continue;
      }
      if (quote) {
        cleanJson += current;
        if (escaped) escaped = false;
        else if (current === "\\\\") escaped = true;
        else if (current === '"') quote = false;
        continue;
      }
      if (current === '"') {
        quote = true;
        cleanJson += current;
      } else if (current === "/" && next === "/") {
        lineComment = true;
        index += 1;
      } else if (current === "/" && next === "*") {
        blockComment = true;
        index += 1;
      } else {
        cleanJson += current;
      }
    }
    return JSON.parse(cleanJson.replace(/,(\s*[\]}])/g, "$1"));
  } catch {
    return null;
  }
}

function addBinding(value: unknown, bindings: Set<string>): void {
  if (typeof value === "string" && /^[A-Za-z_$][\w$]*$/.test(value)) bindings.add(value);
}

function collectJsonConfig(
  value: unknown,
  key: string | undefined,
  info: WranglerConfigInfo,
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectJsonConfig(item, key, info);
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    if (childKey === "main" || childKey === "entry-point") {
      if (typeof childValue === "string") info.entryPoints.push(childValue);
    }
    if (childKey === "binding") addBinding(childValue, info.bindings);
    if (key === "vars" && /^[A-Za-z_$][\w$]*$/.test(childKey)) info.bindings.add(childKey);
    collectJsonConfig(childValue, childKey, info);
  }
}

/** Parse only the stable Wrangler TOML fields needed for reachability/bindings. */
function collectTomlConfig(content: string, info: WranglerConfigInfo): void {
  let section = "";
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const table = line.match(/^\[\[?([^\]]+)\]\]?$/);
    if (table) {
      section = table[1] ?? "";
      continue;
    }
    const assignment = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!assignment) continue;
    const key = assignment[1] ?? "";
    const rawValue = assignment[2]?.trim() ?? "";
    const quoted = rawValue.match(/^['\"]([^'\"]*)['\"](?:\s|$)/)?.[1];
    if ((key === "main" || key === "entry-point") && quoted) info.entryPoints.push(quoted);
    if (key === "binding") addBinding(quoted, info.bindings);
    if ((section === "vars" || section.endsWith(".vars")) && /^[A-Za-z_$][\w$]*$/.test(key)) {
      info.bindings.add(key);
    }
  }
}

function resolveConfigEntry(configFile: string, entryPoint: string): string {
  const configDirectory = path.posix.dirname(configFile.replace(/\\/g, "/"));
  const normalizedEntry = entryPoint.replace(/\\/g, "/");
  return path.posix.normalize(
    normalizedEntry.startsWith("/")
      ? normalizedEntry.slice(1)
      : path.posix.join(configDirectory === "." ? "" : configDirectory, normalizedEntry),
  );
}

async function readWranglerConfig(adapter: PluginAdapter, configFile: string): Promise<void> {
  const content = await adapter.readFile(configFile);
  if (!content) return;
  configState.configFiles.add(configFile);

  const parsedConfig: WranglerConfigInfo = { entryPoints: [], bindings: new Set() };
  let isPagesConfig = false;
  if (configFile.endsWith(".toml")) {
    collectTomlConfig(content, parsedConfig);
    isPagesConfig = /(^|\n)\s*pages_build_output_dir\s*=/.test(content);
  } else {
    const parsed = parseJsonc<Record<string, unknown>>(content);
    if (parsed) {
      collectJsonConfig(parsed, undefined, parsedConfig);
      isPagesConfig = typeof parsed.pages_build_output_dir === "string";
    }
  }

  const configuredEntries =
    parsedConfig.entryPoints.length > 0
      ? parsedConfig.entryPoints
      : isPagesConfig
        ? []
        : ["./worker.js"];
  for (const entryPoint of configuredEntries) {
    const resolvedEntry = resolveConfigEntry(configFile, entryPoint);
    if (!configState.entryPoints.includes(resolvedEntry))
      configState.entryPoints.push(resolvedEntry);
  }
  for (const binding of parsedConfig.bindings) configState.bindings.add(binding);
}

function bindingNameFromMemberExpression(node: any): string | undefined {
  if (!node || (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression"))
    return undefined;
  if (node.computed || !t.isIdentifier(node.property)) return undefined;
  const propertyName = node.property.name;
  if (t.isIdentifier(node.object) && node.object.name === "env") return propertyName;
  const object = node.object;
  if (
    object &&
    (object.type === "MemberExpression" || object.type === "OptionalMemberExpression") &&
    !object.computed &&
    t.isIdentifier(object.property) &&
    object.property.name === "env"
  ) {
    return propertyName;
  }
  return undefined;
}

function markBindingUsed(fileId: string, binding: string): void {
  const bindings = configState.usedBindings.get(fileId) ?? new Set<string>();
  bindings.add(binding);
  configState.usedBindings.set(fileId, bindings);
}

function isWorkerScopedFile(fileId: string): boolean {
  const normalized = fileId.replace(/\\/g, "/");
  return (
    configState.entryPoints.some(
      (entry) => normalized === entry || normalized.endsWith(`/${entry}`),
    ) ||
    normalized.includes("/functions/") ||
    normalized.startsWith("functions/")
  );
}

function emitMissingBinding(adapter: PluginAdapter, fileId: string, binding: string): void {
  adapter.emitFinding({
    rule: "missing-wrangler-binding",
    severity: "warning",
    confidence: "medium",
    file: fileId,
    message:
      configState.configFiles.size === 0
        ? `Cloudflare binding '${binding}' is used in code, but no Wrangler configuration file was found.`
        : `Cloudflare binding '${binding}' is used in code but is not declared in the Wrangler configuration.`,
    evidence: { binding, configFiles: [...configState.configFiles] },
  });
}

export const WranglerPlugin: AnalyzerPlugin = {
  name: "wrangler-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check package.json dependencies and scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (
        Object.keys(allDeps).some((dep) => dep === "wrangler" || dep.startsWith("@cloudflare/"))
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (s.includes("wrangler ") || s === "wrangler"),
          )
        ) {
          return true;
        }
      }
    }

    // 2. Check for Wrangler configuration files, including workspace configs.
    const discoveredConfigs =
      typeof adapter.findFiles === "function" ? await adapter.findFiles(WRANGLER_CONFIG_FILES) : [];
    if (discoveredConfigs.length > 0) return true;
    for (const configFile of WRANGLER_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 3. Check for Cloudflare Pages / Functions directory or .cloudflare folder
    return (await adapter.folderExists("functions")) || (await adapter.folderExists(".cloudflare"));
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      resetConfigState();
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies,
      };

      const hasWrangler = Object.keys(allDeps).some(
        (p) => p === "wrangler" || p.startsWith("@cloudflare/"),
      );

      // 1. Safeguard installed Cloudflare packages in package.json
      if (hasWrangler) {
        for (const depName of Object.keys(allDeps)) {
          if (depName === "wrangler" || depName.startsWith("@cloudflare/")) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }

      // 2. Protect and parse every supported Wrangler configuration file,
      // including configurations belonging to nested workspace projects.
      let hasConfigFile = false;
      const discoveredConfigs =
        typeof adapter.findFiles === "function"
          ? await adapter.findFiles(WRANGLER_CONFIG_FILES)
          : [];
      const configFiles = new Set(discoveredConfigs);
      for (const configFile of WRANGLER_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) configFiles.add(configFile);
      }
      for (const configFile of configFiles) {
        hasConfigFile = true;
        adapter.markAsUsed(configFile);
        adapter.markPackageAsUsed("wrangler");
        await readWranglerConfig(adapter, configFile);
      }

      if (configState.entryPoints.length > 0) {
        adapter.addEntryPatterns(configState.entryPoints);
        for (const entryPoint of configState.entryPoints) adapter.markAsUsed(entryPoint);
      }

      for (const specialFile of WRANGLER_SPECIAL_FILES) {
        if (await adapter.folderExists(specialFile)) {
          adapter.markAsUsed(specialFile);
        }
      }

      // 3. Protect Cloudflare Pages Functions directory (functions/)
      if (await adapter.folderExists("functions")) {
        adapter.markAsUsed("functions");
      }

      // 4. Track npm scripts invoking Wrangler CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("wrangler ") || scriptContent === "wrangler")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("wrangler");
          }
        }
      }

      // 5. Inspect JSON/JSONC configuration files for main entry points
      for (const jsonConfigName of ["wrangler.jsonc", "wrangler.json"]) {
        const content = await adapter.readFile(jsonConfigName);
        if (content) {
          const parsed = parseJsonc(content);
          if (parsed) {
            if (typeof parsed.main === "string") {
              adapter.markAsUsed(parsed.main);
            }
            if (typeof parsed.site?.["entry-point"] === "string") {
              adapter.markAsUsed(parsed.site["entry-point"]);
            }
          }
        }
      }

      // 6. Report code/config binding mismatches after AST scanning.
      // The actual diagnostics are emitted from onAnalysisComplete, once all
      // files have been visited and all binding usages are known.

      // 7. Report missing dependency if Wrangler config exists without wrangler package
      if (hasConfigFile && !hasWrangler) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Wrangler configuration file found, but 'wrangler' is not listed in package.json.",
          evidence: { hasConfigFile },
        });
      }
    },

    onFileStart: async (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect and parse Wrangler configuration files in every lifecycle run.
      if (WRANGLER_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("wrangler");
        await readWranglerConfig(adapter, normalized);
        if (configState.entryPoints.length > 0) {
          adapter.addEntryPatterns(configState.entryPoints);
          for (const entryPoint of configState.entryPoints) adapter.markAsUsed(entryPoint);
        }
      }

      // Protect special Wrangler generated files
      if (WRANGLER_SPECIAL_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }

      // Protect all Cloudflare Pages functions inside functions/
      if (normalized.includes("/functions/") || normalized.startsWith("functions/")) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("wrangler");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Detect ESM imports for wrangler or @cloudflare/* packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "wrangler" || source.startsWith("@cloudflare/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Track runtime bindings exposed through env or context.env.
      const bindingFromMember = isWorkerScopedFile(fileId)
        ? bindingNameFromMemberExpression(node)
        : undefined;
      if (bindingFromMember) {
        markBindingUsed(fileId, bindingFromMember);
        adapter.markPackageAsUsed("wrangler");
      }

      // `const { DB, KV } = env` is also a standard Workers access pattern.
      if (
        isWorkerScopedFile(fileId) &&
        node.type === "VariableDeclarator" &&
        node.id?.type === "ObjectPattern"
      ) {
        const init = node.init;
        const isEnvObject =
          (t.isIdentifier(init) && init.name === "env") ||
          (init &&
            (init.type === "MemberExpression" || init.type === "OptionalMemberExpression") &&
            !init.computed &&
            t.isIdentifier(init.property) &&
            init.property.name === "env");
        if (isEnvObject) {
          for (const property of node.id.properties ?? []) {
            if (
              (property.type === "Property" || property.type === "ObjectProperty") &&
              t.isIdentifier(property.key)
            ) {
              markBindingUsed(fileId, property.key.name);
              adapter.markPackageAsUsed("wrangler");
            }
          }
        }
      }

      // 3. Protect Cloudflare Worker fetch / scheduled event handlers
      if (t.isExportDefaultDeclaration(node) && t.isObjectExpression(node.declaration)) {
        node.declaration.properties.forEach((prop: any) => {
          if (
            t.isObjectProperty(prop) &&
            t.isIdentifier(prop.key) &&
            ["fetch", "scheduled", "queue", "trace", "email"].includes(prop.key.name)
          ) {
            adapter.markAsUsed(fileId, prop.key.name);
          }
        });
      }
    },

    onAnalysisComplete: async (adapter) => {
      if (configState.configFiles.size === 0) {
        const discoveredConfigs =
          typeof adapter.findFiles === "function"
            ? await adapter.findFiles(WRANGLER_CONFIG_FILES)
            : [];
        for (const configFile of discoveredConfigs) await readWranglerConfig(adapter, configFile);
        for (const configFile of WRANGLER_CONFIG_FILES) {
          if (await adapter.folderExists(configFile)) await readWranglerConfig(adapter, configFile);
        }
      }
      for (const [fileId, bindings] of configState.usedBindings.entries()) {
        for (const binding of bindings) {
          if (!configState.bindings.has(binding)) emitMissingBinding(adapter, fileId, binding);
        }
      }
      resetConfigState();
    },
  },
};

export default WranglerPlugin;
