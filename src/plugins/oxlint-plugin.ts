import { AnalyzerPlugin } from "../types.js";

export const OxlintPlugin: AnalyzerPlugin = {
  name: "oxlint-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    return !!(pkg?.devDependencies?.["oxlint"] || pkg?.dependencies?.["oxlint"]);
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      // Durchsuche alle Skripte nach oxlint-Aufrufen
      if (pkg?.scripts) {
        for (const [name, script] of Object.entries(pkg.scripts)) {
          if (typeof script === "string" && script.includes("oxlint")) {
            adapter.markAsUsed("package.json", `scripts:${name}`);
          }
        }
      }
    },
    onFileStart: (fileId, adapter) => {
      // Schützt Konfigurationsdateien
      if (fileId.includes("oxlint") || fileId.endsWith(".oxlintrc.json")) {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default OxlintPlugin;
