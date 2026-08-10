import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const TSCONFIG_FILE_PATTERN = /^tsconfig(\..+)?\.json$/;

const DEFAULT_TSCONFIG_VARIANTS = [
  "tsconfig.json",
  "tsconfig.build.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
  "tsconfig.base.json",
  "tsconfig.lib.json",
  "tsconfig.eslint.json"
];

const TYPESCRIPT_PACKAGES = [
  "typescript",
  "ts-node",
  "tsx",
  "@types/node"
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

export const TsconfigPlusPlugin: AnalyzerPlugin = {
  name: "tsconfig-plus-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for any tsconfig*.json file in root
    for (const file of DEFAULT_TSCONFIG_VARIANTS) {
      if (await adapter.folderExists(file)) return true;
    }

    // 2. Check package.json for TypeScript dependencies or scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (Object.keys(allDeps).some((dep) => TYPESCRIPT_PACKAGES.includes(dep))) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" &&
              (s.includes("tsc ") || s === "tsc" || s.includes("tsc--"))
          )
        ) {
          return true;
        }
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

      const hasTs = "typescript" in allDeps;

      // 1. Safeguard core TypeScript packages in package.json
      for (const tsPkg of TYPESCRIPT_PACKAGES) {
        if (tsPkg in allDeps) {
          adapter.markPackageAsUsed(tsPkg);
        }
      }

      // 2. Scan and parse all found tsconfig*.json files
      let hasConfigFile = false;
      for (const configFile of DEFAULT_TSCONFIG_VARIANTS) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);

          const content = await adapter.readFile(configFile);
          if (content) {
            const configObj = parseJsonc(content);
            if (configObj) {
              processTsconfigObject(configObj, adapter);
            }
          }
        }
      }

      // 3. Track npm scripts invoking TypeScript CLI (tsc)
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("tsc ") ||
              scriptContent === "tsc" ||
              scriptContent.includes("tsc -") ||
              scriptContent.includes("tscbuild"))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("typescript");
          }
        }
      }

      // 4. Report missing dependency if tsconfig files exist without typescript
      if (hasConfigFile && !hasTs) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "TypeScript configuration file found, but 'typescript' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect all tsconfig*.json files
      if (TSCONFIG_FILE_PATTERN.test(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("typescript");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      // Protect ESM imports for typescript compiler API
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "typescript" || source.startsWith("typescript/")) {
          adapter.markPackageAsUsed("typescript");
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

/**
 * Parses deep tsconfig properties: extends, compilerOptions, paths, references, etc.
 */
function processTsconfigObject(config: Record<string, any>, adapter: any): void {
  // A. Extends chain (e.g. extends: "@tsconfig/strictest/tsconfig.json" or "./tsconfig.base.json")
  if (typeof config.extends === "string") {
    if (config.extends.startsWith(".") || config.extends.startsWith("/")) {
      adapter.markAsUsed(config.extends);
    } else {
      // Extends shared tsconfig package: @tsconfig/node18, @sveltejs/kit/tsconfig.json
      const pkgName = config.extends.startsWith("@")
        ? config.extends.split("/").slice(0, 2).join("/")
        : config.extends.split("/")[0];
      if (pkgName) {
        adapter.markPackageAsUsed(pkgName);
      }
    }
  } else if (Array.isArray(config.extends)) {
    config.extends.forEach((extPath: any) => {
      if (typeof extPath === "string") {
        if (extPath.startsWith(".") || extPath.startsWith("/")) {
          adapter.markAsUsed(extPath);
        } else {
          const pkgName = extPath.startsWith("@")
            ? extPath.split("/").slice(0, 2).join("/")
            : extPath.split("/")[0];
          if (pkgName) adapter.markPackageAsUsed(pkgName);
        }
      }
    });
  }

  // B. Project References (e.g. references: [{ path: "./packages/shared" }])
  if (Array.isArray(config.references)) {
    config.references.forEach((ref: any) => {
      if (typeof ref?.path === "string") {
        adapter.markAsUsed(ref.path);
      }
    });
  }

  // C. Files, Include, and Exclude Globs
  ["files", "include"].forEach((field) => {
    if (Array.isArray(config[field])) {
      config[field].forEach((filePath: any) => {
        if (typeof filePath === "string") {
          adapter.markAsUsed(filePath);
        }
      });
    }
  });

  // D. Compiler Options Analysis
  const opts = config.compilerOptions;
  if (typeof opts === "object" && opts !== null) {
    // 1. Output & Declaration Directories
    ["outDir", "declarationDir", "rootDir", "baseUrl"].forEach((dirKey) => {
      if (typeof opts[dirKey] === "string") {
        adapter.markAsUsed(opts[dirKey]);
      }
    });

    // 2. RootDirs array (multi-root project setup)
    if (Array.isArray(opts.rootDirs)) {
      opts.rootDirs.forEach((rDir: any) => {
        if (typeof rDir === "string") adapter.markAsUsed(rDir);
      });
    }

    // 3. Path Aliases (paths: { "@/*": ["src/*"] })
    if (typeof opts.paths === "object" && opts.paths !== null) {
      for (const [, targets] of Object.entries(opts.paths)) {
        if (Array.isArray(targets)) {
          targets.forEach((targetPath: any) => {
            if (typeof targetPath === "string") {
              const cleanPath = targetPath.replace(/\/\*$/, "");
              adapter.markAsUsed(cleanPath);
            }
          });
        }
      }
    }

    // 4. Custom JSX Import Sources (e.g. jsxImportSource: "react", "preact", "vue")
    if (typeof opts.jsxImportSource === "string") {
      adapter.markPackageAsUsed(opts.jsxImportSource);
    }

    // 5. Explicit Types and TypeRoots (@types/* dependencies)
    if (Array.isArray(opts.types)) {
      opts.types.forEach((typePkg: any) => {
        if (typeof typePkg === "string") {
          adapter.markPackageAsUsed(`@types/${typePkg}`);
        }
      });
    }

    if (Array.isArray(opts.typeRoots)) {
      opts.typeRoots.forEach((typeRoot: any) => {
        if (typeof typeRoot === "string") {
          adapter.markAsUsed(typeRoot);
        }
      });
    }

    // 6. Plugins (e.g. plugins: [{ name: "ts-sql-plugin" }, { name: "@styled/typescript-styled-plugin" }])
    if (Array.isArray(opts.plugins)) {
      opts.plugins.forEach((pluginObj: any) => {
        if (typeof pluginObj?.name === "string") {
          adapter.markPackageAsUsed(pluginObj.name);
        }
      });
    }
  }
}

export default TsconfigPlusPlugin;