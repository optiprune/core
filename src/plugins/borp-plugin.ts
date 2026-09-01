import path from "pathe";
import type { AnalyzerPlugin } from "../types.js";

const BORP_CONFIG = ".borp.yaml";

function packageRoot(specifier: string): string {
  return specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0] ?? specifier;
}

export const BorpPlugin: AnalyzerPlugin = {
  name: "borp-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (Object.values(pkg?.scripts ?? {}).some((script) => typeof script === "string" && /\bborp\b/.test(script))) return true;
    return (await adapter.readFile(BORP_CONFIG)) !== null;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const config = await adapter.readFile(BORP_CONFIG);
      if (config !== null) {
        adapter.markAsUsed(BORP_CONFIG);
        const reporterMatches = config.matchAll(/['"](@?[^'"\s]+(?:\/[^'"\s]+)?)['"]/g);
        for (const match of reporterMatches) {
          const value = match[1] ?? "";
          if (value.startsWith("@jsumners/") || value.startsWith("./reporters/")) {
            if (value.startsWith("@")) adapter.markPackageAsUsed(packageRoot(value));
            else adapter.markAsUsed(value);
          }
        }
        const filePatterns = [...config.matchAll(/^\s*-\s*['"]([^'"]+)['"]/gm)]
          .map((match) => match[1])
          .filter((value): value is string => typeof value === "string" && value.includes("*"));
        for (const file of await adapter.findFilesByGlob(filePatterns)) adapter.markAsUsed(file);
      }
      for (const script of Object.values(pkg?.scripts ?? {})) {
        if (typeof script !== "string") continue;
        if (/\bborp\b/.test(script)) adapter.markPackageAsUsed("borp");
        if (/\bc8\b/.test(script)) adapter.markPackageAsUsed("c8");
        const reporters = script.matchAll(/--reporter\s+\.\/?([^\s:]+)/g);
        for (const reporter of reporters) {
          const reporterPath = reporter[1];
          if (reporterPath) adapter.markAsUsed(reporterPath);
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      if (path.basename(fileId) === BORP_CONFIG) adapter.markAsUsed(fileId);
      if (/\.(check|spec)\.[cm]?[jt]sx?$/.test(fileId)) adapter.markAsUsed(fileId);
      if (fileId.includes("/reporters/")) adapter.markAsUsed(fileId);
    },
  },
};

export default BorpPlugin;
