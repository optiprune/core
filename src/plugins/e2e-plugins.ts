import { AnalyzerPlugin } from "../types.js";

const E2E_PATH_REGEX = /(playwright\.config|cypress\.config|\/e2e\/|\/tests\/e2e\/|cypress\/|\.(spec|e2e-spec)\.[jt]sx?$)/;

export const E2EPlugin: AnalyzerPlugin = {
  name: "e2e-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
    return "@playwright/test" in deps || "cypress" in deps;
  },

  lifecycle: {
    onFileStart: (fileId, adapter) => {
      if (E2E_PATH_REGEX.test(fileId)) {
        adapter.markAsUsed(fileId);
      }
    },
  },
};

export default E2EPlugin;