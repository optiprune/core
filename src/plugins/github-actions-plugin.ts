import { AnalyzerPlugin } from "../types.js";

export const GithubActionsPlugin: AnalyzerPlugin = {
  name: "github-actions-plugin",
  version: "1.0.0",
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      // Schützt alle Dateien im .github/workflows Ordner sowie action.yml Metadaten
      if (fileId.includes(".github/workflows/") || fileId.endsWith("action.yml") || fileId.endsWith("action.yaml")) {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default GithubActionsPlugin;
