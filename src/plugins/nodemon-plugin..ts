import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const NODEMON_CONFIG_FILES = ["nodemon.json", ".nodemonignore"];

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

export const NodemonPlugin: AnalyzerPlugin = {
  name: "nodemon-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check package.json dependencies, nodemonConfig field, or scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if ("nodemon" in allDeps || pkg.nodemonConfig) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (s.includes("nodemon ") || s === "nodemon"),
          )
        ) {
          return true;
        }
      }
    }

    // 2. Check for configuration files
    for (const configFile of NODEMON_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies,
      };

      const hasNodemonDep = "nodemon" in allDeps;

      // 1. Safeguard nodemon package in package.json
      if (hasNodemonDep) {
        adapter.markPackageAsUsed("nodemon");
      }

      // 2. Protect standalone configuration files
      let hasConfigFile = false;
      for (const configFile of NODEMON_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Process package.json "nodemonConfig" block if present
      let nodemonConfig: any = null;
      if (pkg?.nodemonConfig) {
        hasConfigFile = true;
        adapter.markAsUsed("package.json", "nodemonConfig");
        nodemonConfig = pkg.nodemonConfig;
      }

      // 4. Track npm scripts invoking Nodemon CLI (e.g. "dev": "nodemon src/index.ts")
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("nodemon ") || scriptContent === "nodemon")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("nodemon");

            // Extract entry script target from command: "nodemon src/server.js" -> "src/server.js"
            const parts = scriptContent.split(/\s+/);
            const nodemonIdx = parts.findIndex((p) => p === "nodemon");
            if (nodemonIdx !== -1 && parts[nodemonIdx + 1]) {
              const target = parts
                .slice(nodemonIdx + 1)
                .find((p) => !p.startsWith("-") && p.includes("."));

              if (target) {
                adapter.markAsUsed(target);
              }
            }
          }
        }
      }

      // 5. Inspect JSON config file (nodemon.json) for watched folders and exec target
      if (!nodemonConfig) {
        const content = await adapter.readFile("nodemon.json");
        if (content) {
          const parsed = parseJsonc(content);
          if (parsed) {
            nodemonConfig = parsed;
          }
        }
      }

      // 6. Process configured watch directories and entry scripts
      if (nodemonConfig && typeof nodemonConfig === "object") {
        processNodemonConfigObj(nodemonConfig, adapter);
      }

      // 7. Report missing dependency if configuration exists without nodemon package
      if (hasConfigFile && !hasNodemonDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Nodemon configuration found, but 'nodemon' is not listed in package.json.",
          evidence: { hasConfigFile, hasPkgBlock: !!pkg?.nodemonConfig },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect Nodemon configuration files
      if (NODEMON_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("nodemon");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      // Detect programmatic ESM imports for nodemon (e.g. import nodemon from 'nodemon')
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "nodemon") {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // Detect CJS require('nodemon')
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (t.isStringLiteral(arg) && arg.value === "nodemon") {
          adapter.markPackageAsUsed("nodemon");
          adapter.markAsUsed(fileId);
        }
      }
    },
  },
};

function processNodemonConfigObj(configObj: Record<string, any>, adapter: any): void {
  // Extract target execution script: script: "src/index.ts"
  if (typeof configObj.script === "string") {
    adapter.markAsUsed(configObj.script);
  }

  // Extract custom execution string: exec: "ts-node src/index.ts"
  if (typeof configObj.exec === "string") {
    const parts = configObj.exec.split(/\s+/);
    parts.forEach((part: string) => {
      if (part.includes(".") && !part.startsWith("-")) {
        adapter.markAsUsed(part);
      }
    });
  }

  // Extract watched directories or files: watch: ["src/", "config/"]
  if (Array.isArray(configObj.watch)) {
    configObj.watch.forEach((watchPath: any) => {
      if (typeof watchPath === "string") {
        adapter.markAsUsed(watchPath);
      }
    });
  } else if (typeof configObj.watch === "string") {
    adapter.markAsUsed(configObj.watch);
  }
}

export default NodemonPlugin;
