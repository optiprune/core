import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const VERCEL_CONFIG_FILES = [
  "vercel.json",
  "now.json",
  ".vercelignore"
];

const VERCEL_PACKAGES = [
  "vercel",
  "@vercel/og",
  "@vercel/kv",
  "@vercel/postgres",
  "@vercel/blob",
  "@vercel/edge",
  "@vercel/node",
  "@vercel/analytics",
  "@vercel/speed-insights",
  "@vercel/flags"
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

export const VercelPlugin: AnalyzerPlugin = {
  name: "vercel-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (
        Object.keys(allDeps).some(
          (dep) => dep === "vercel" || dep.startsWith("@vercel/")
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" && (s.includes("vercel") || s.includes("now "))
          )
        ) {
          return true;
        }
      }
    }

    for (const configFile of VERCEL_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return (
      (await adapter.folderExists("api")) ||
      (await adapter.folderExists(".vercel"))
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

      const hasVercel = Object.keys(allDeps).some(
        (p) => p === "vercel" || p.startsWith("@vercel/")
      );

      // 1. Safeguard installed Vercel ecosystem packages in package.json
      if (hasVercel) {
        for (const depName of Object.keys(allDeps)) {
          if (depName === "vercel" || depName.startsWith("@vercel/")) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }

      // 2. Protect standalone configuration files
      let hasConfigFile = false;
      for (const configFile of VERCEL_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Track npm scripts invoking Vercel CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("vercel") || scriptContent.includes("now "))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("vercel");
          }
        }
      }

      // 4. Inspect vercel.json for custom builds and functions
      const vercelJsonContent = await adapter.readFile("vercel.json");
      if (vercelJsonContent) {
        const vercelJson = parseJsonc(vercelJsonContent);
        if (vercelJson) {
          // Process builds: [{ src: "api/*.js", use: "@vercel/node" }]
          if (Array.isArray(vercelJson.builds)) {
            vercelJson.builds.forEach((build: any) => {
              if (typeof build.src === "string") {
                adapter.markAsUsed(build.src);
              }
              if (typeof build.use === "string") {
                adapter.markPackageAsUsed(build.use);
              }
            });
          }

          // Process functions: { "api/**/*.js": { memory: 1024 } }
          if (typeof vercelJson.functions === "object" && vercelJson.functions) {
            Object.keys(vercelJson.functions).forEach((pattern) => {
              adapter.markAsUsed(pattern);
            });
          }
        }
      }

      // 5. Emit finding if config exists without Vercel package
      if (hasConfigFile && !hasVercel) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Vercel configuration found, but 'vercel' or '@vercel/*' packages are not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (VERCEL_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("vercel");
      }

      // Protect Vercel Serverless Functions (/api/*)
      if (normalized.includes("/api/") || normalized.startsWith("api/")) {
        adapter.markAsUsed(fileId);
      }

      // Protect Vercel OG image routing conventions
      if (
        basename.includes("opengraph-image") ||
        basename.includes("twitter-image") ||
        basename.includes("icon") ||
        basename.includes("apple-icon")
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // Detect ESM imports for @vercel/* packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "vercel" || source.startsWith("@vercel/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default VercelPlugin;