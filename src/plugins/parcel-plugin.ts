import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Parcel Plugin
 * Handles Parcel-specific patterns: .parcelrc, package.json entries, and entry points.
 */
export const ParcelPlugin: AnalyzerPlugin = {
  name: "parcel-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const hasDep = !!(pkg.dependencies?.["parcel"] || pkg.devDependencies?.["parcel"] || pkg.dependencies?.["parcel-bundler"]);
      if (hasDep) return true;
      // Parcel often uses 'source' or 'targets' in package.json
      if (pkg.source || pkg.targets) return true;
    }
    const configFiles = [".parcelrc", "parcel.config.js"];
    for (const file of configFiles) {
      if (await adapter.readFile(file)) return true;
    }
    return false;
  },
  lifecycle: {
    onFileStart: async (fileId, adapter) => {
      if ([".parcelrc", "parcel.config.js"].some(f => fileId.endsWith(f))) {
        adapter.markAsUsed(fileId);
      }

      // Check package.json for Parcel entry points (e.g., "source": "src/index.html")
      if (fileId.endsWith("package.json")) {
        const pkg = await adapter.readJson("package.json");
        if (pkg) {
          if (typeof pkg.source === "string") {
            adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, pkg.source));
          } else if (Array.isArray(pkg.source)) {
            pkg.source.forEach((s: string) => adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, s)));
          }

          if (pkg.targets) {
            for (const targetKey of Object.keys(pkg.targets)) {
              const target = pkg.targets[targetKey];
              if (target && typeof target.source === "string") {
                adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, target.source));
              }
            }
          }
        }
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Detect Parcel specific API usage or configuration
      if (fileId.endsWith(".parcelrc") || fileId.endsWith("parcel.config.js")) {
        if (t.isObjectExpression(node)) {
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default ParcelPlugin;
