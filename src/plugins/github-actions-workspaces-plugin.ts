import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const GithubActionsWorkspacesPlugin: AnalyzerPlugin = {
  name: "github-actions-workspaces-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "github-actions-workspaces");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "github-actions-workspaces"))
        markDeclaredPackage(adapter, "github-actions-workspaces");
    },
  },
};

export default GithubActionsWorkspacesPlugin;
