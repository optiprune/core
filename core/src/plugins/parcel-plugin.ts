import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";
import { fileExists, hasCommand, parsePluginJson } from "../plugin-utils.js";

const PARCEL_CONFIG_FILES = [
  ".parcelrc",
  ".parcelrc.json",
  ".parcelrc.js",
  ".parcelrc.cjs",
  ".parcelrc.mjs",
  "parcel.config.js",
  "parcel.config.cjs",
  "parcel.config.mjs",
];

const PARCEL_CORE_PACKAGES = ["parcel", "parcel-bundler", "@parcel/config-default"];

const parseJsonc = parsePluginJson;

export const ParcelPlugin: AnalyzerPlugin = {
  name: "parcel-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (
        Object.keys(allDeps).some(
          (dep) => dep === "parcel" || dep === "parcel-bundler" || dep.startsWith("@parcel/"),
        )
      ) {
        return true;
      }

      if (pkg.source || pkg.targets) return true;

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (scriptValues.some((s) => typeof s === "string" && hasCommand(s, ["parcel"]))) {
          return true;
        }
      }
    }

    for (const configFile of PARCEL_CONFIG_FILES) {
      if (await fileExists(adapter, configFile)) return true;
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

      const hasParcel = Object.keys(allDeps).some(
        (p) => p === "parcel" || p === "parcel-bundler" || p.startsWith("@parcel/"),
      );

      // 1. Safeguard all installed Parcel ecosystem packages in package.json
      if (hasParcel) {
        for (const depName of Object.keys(allDeps)) {
          if (
            depName === "parcel" ||
            depName === "parcel-bundler" ||
            depName.startsWith("@parcel/") ||
            depName.startsWith("parcel-plugin-")
          ) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }

      // 2. Protect standalone Parcel configuration files
      let hasConfigFile = false;
      for (const configFile of PARCEL_CONFIG_FILES) {
        if (await fileExists(adapter, configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Extract entry points defined in package.json "source" and "targets"
      if (pkg) {
        if (typeof pkg.source === "string") {
          if (pkg.source.includes("*") || pkg.source.includes("?")) adapter.markAsUsed(pkg.source);
          else adapter.markRelativeFileAsUsed("package.json", pkg.source);
          adapter.markAsUsed("package.json", "source");
        } else if (Array.isArray(pkg.source)) {
          pkg.source.forEach((s: string) => {
            if (typeof s === "string") {
              if (s.includes("*") || s.includes("?")) adapter.markAsUsed(s);
              else adapter.markRelativeFileAsUsed("package.json", s);
            }
          });
          adapter.markAsUsed("package.json", "source");
        }

        if (pkg.targets && typeof pkg.targets === "object") {
          adapter.markAsUsed("package.json", "targets");
          for (const targetKey of Object.keys(pkg.targets)) {
            const target = pkg.targets[targetKey];
            if (target && typeof target.source === "string") {
              if (target.source.includes("*") || target.source.includes("?"))
                adapter.markAsUsed(target.source);
              else adapter.markRelativeFileAsUsed("package.json", target.source);
            } else if (target && Array.isArray(target.source)) {
              target.source.forEach((s: string) => {
                if (typeof s === "string") {
                  if (s.includes("*") || s.includes("?")) adapter.markAsUsed(s);
                  else adapter.markRelativeFileAsUsed("package.json", s);
                }
              });
            }
          }
        }
      }

      // 4. Track npm scripts invoking Parcel CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (typeof scriptContent === "string" && hasCommand(scriptContent, ["parcel"])) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("parcel");
          }
        }
      }

      // 5. Inspect .parcelrc / .parcelrc.json for plugins, extends, and transformers
      let parcelConfigName: string | undefined;
      for (const candidate of PARCEL_CONFIG_FILES) {
        if (await fileExists(adapter, candidate)) {
          parcelConfigName = candidate;
          break;
        }
      }
      const parcelRcContent = parcelConfigName ? await adapter.readFile(parcelConfigName) : null;
      if (parcelRcContent) {
        const parcelRc = parseJsonc<Record<string, any>>(parcelRcContent);
        if (parcelRc) {
          // Process extends: "@parcel/config-default"
          if (typeof parcelRc.extends === "string") {
            adapter.markPackageAsUsed(parcelRc.extends);
          } else if (Array.isArray(parcelRc.extends)) {
            parcelRc.extends.forEach((ext: string) => {
              if (typeof ext === "string") adapter.markPackageAsUsed(ext);
            });
          }

          // Process plugin maps (transformers, resolvers, bundler, namers, packagers, reporters, validators)
          const pluginCategories = [
            "resolvers",
            "transformers",
            "bundler",
            "namers",
            "packagers",
            "reporters",
            "validators",
          ];

          for (const category of pluginCategories) {
            const configEntry = parcelRc[category];
            if (!configEntry) continue;

            if (Array.isArray(configEntry)) {
              configEntry.forEach((p: string) => {
                if (typeof p === "string" && !p.startsWith("...")) {
                  adapter.markPackageAsUsed(p);
                }
              });
            } else if (typeof configEntry === "object") {
              for (const pluginList of Object.values<any>(configEntry)) {
                if (Array.isArray(pluginList)) {
                  pluginList.forEach((p: string) => {
                    if (typeof p === "string" && !p.startsWith("...")) {
                      adapter.markPackageAsUsed(p);
                    }
                  });
                }
              }
            }
          }
        }
      }

      // 6. Report missing dependency if configuration exists without parcel package
      if (hasConfigFile && !hasParcel) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Parcel configuration found, but 'parcel' or 'parcel-bundler' is not listed in package.json.",
          evidence: { hasConfigFile },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect Parcel configuration files
      if (PARCEL_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("parcel");
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = PARCEL_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for @parcel/* packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "parcel" || source.startsWith("@parcel/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In JavaScript Parcel configuration files (parcel.config.js / .parcelrc.js)
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("parcel");
        }

        // CommonJS module.exports = { ... }
        if (
          node?.type === "AssignmentExpression" &&
          (node as any).left?.type === "MemberExpression" &&
          (node as any).left?.object?.name === "module" &&
          (node as any).left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("parcel");
        }
      }
    },
  },
};

export default ParcelPlugin;
