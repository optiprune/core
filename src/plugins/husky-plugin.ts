import { AnalyzerPlugin } from "../types.js";

export const HuskyPlugin: AnalyzerPlugin = {
  name: "husky-plugin",
  version: "1.1.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    return !!(pkg?.devDependencies?.["husky"] || pkg?.dependencies?.["husky"]);
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      // Husky wird oft über das 'prepare' Skript installiert/aktiviert.
      // Wenn Husky detektiert wird, markieren wir das Skript und die Abhängigkeit als aktiv.
      if (pkg?.scripts?.prepare?.includes("husky")) {
        adapter.markAsUsed("package.json", "scripts:prepare");
      }
    },
    onFileStart: (fileId, adapter) => {
      // Schützt alle Hook-Skripte (pre-commit, pre-push etc.) im .husky Verzeichnis
      if (fileId.includes(".husky/")) {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default HuskyPlugin;
