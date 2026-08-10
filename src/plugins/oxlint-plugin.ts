import { AnalyzerPlugin } from "../types.js";

export const OxlintPlugin: AnalyzerPlugin = {
  name: "oxlint-plugin",
  version: "1.1.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    return !!(pkg?.devDependencies?.["oxlint"] || pkg?.dependencies?.["oxlint"]);
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      
      if (pkg?.scripts) {
        for (const [name, script] of Object.entries(pkg.scripts)) {
          if (typeof script === "string" && script.includes("oxlint")) {
            adapter.markAsUsed("package.json", `scripts:${name}`);

            const configMatch = script.match(/(?:-c|--config)\s+([^\s]+)/);
            if (configMatch && configMatch[1]) {
              adapter.markAsUsed(configMatch[1]);
            }
          }
        }
      }

      const configFiles = [
        ".oxlintrc.json",
        "oxlint.json",
        ".oxlintrc",
        "oxlintrc.json"
      ];

      for (const configPath of configFiles) {
        // Use folderExists instead of fileExists
        if (await adapter.folderExists(configPath)) {
          adapter.markAsUsed(configPath);
        }
      }
    },
    onFileStart: (fileId, adapter) => {
      const normalized = fileId.toLowerCase();
      if (
        normalized.includes("oxlint") ||
        normalized.endsWith(".oxlintrc.json") ||
        normalized.endsWith("oxlint.json")
      ) {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default OxlintPlugin;