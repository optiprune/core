import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const WRANGLER_CONFIG_FILES = [
  "wrangler.jsonc",
  "wrangler.json",
  "wrangler.toml"
];

const WRANGLER_SPECIAL_FILES = [
  "worker-configuration.d.ts",
  ".dev.vars"
];

const CLOUDFLARE_PACKAGES = [
  "wrangler",
  "@cloudflare/workers-types",
  "@cloudflare/vite-plugin",
  "@cloudflare/next-on-pages",
  "@cloudflare/kv-asset-handler",
  "@cloudflare/ai"
];

function parseJsonc<T = any>(content: string): T | null {
  try {
    const cleanJson = content
      .replace(/\/\/.*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/,(\s*[\]}])/g, "$1");
    return JSON.parse(cleanJson);
  } catch {
    return null;
  }
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
        ...pkg.peerDependencies
      };

      if (
        Object.keys(allDeps).some(
          (dep) => dep === "wrangler" || dep.startsWith("@cloudflare/")
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" &&
              (s.includes("wrangler ") || s === "wrangler")
          )
        ) {
          return true;
        }
      }
    }

    // 2. Check for Wrangler configuration files
    for (const configFile of WRANGLER_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 3. Check for Cloudflare Pages / Functions directory or .cloudflare folder
    return (
      (await adapter.folderExists("functions")) ||
      (await adapter.folderExists(".cloudflare"))
    );
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

      const hasWrangler = Object.keys(allDeps).some(
        (p) => p === "wrangler" || p.startsWith("@cloudflare/")
      );

      // 1. Safeguard installed Cloudflare packages in package.json
      if (hasWrangler) {
        for (const depName of Object.keys(allDeps)) {
          if (depName === "wrangler" || depName.startsWith("@cloudflare/")) {
            adapter.markPackageAsUsed(depName);
          }
        }
      }

      // 2. Protect standalone configuration and special generated files
      let hasConfigFile = false;
      for (const configFile of WRANGLER_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
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

      // 6. Report missing dependency if Wrangler config exists without wrangler package
      if (hasConfigFile && !hasWrangler) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Wrangler configuration file found, but 'wrangler' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect Wrangler configuration files
      if (WRANGLER_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("wrangler");
      }

      // Protect special Wrangler generated files
      if (WRANGLER_SPECIAL_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }

      // Protect all Cloudflare Pages functions inside functions/
      if (
        normalized.includes("/functions/") ||
        normalized.startsWith("functions/")
      ) {
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

      // 2. Protect Cloudflare Worker fetch / scheduled event handlers
      if (
        t.isExportDefaultDeclaration(node) &&
        t.isObjectExpression(node.declaration)
      ) {
        node.declaration.properties.forEach((prop: any) => {
          if (
            t.isObjectProperty(prop) &&
            t.isIdentifier(prop.key) &&
            ["fetch", "scheduled", "queue", "trace", "email"].includes(
              prop.key.name
            )
          ) {
            adapter.markAsUsed(fileId, prop.key.name);
          }
        });
      }
    }
  }
};

export default WranglerPlugin;