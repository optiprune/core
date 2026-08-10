import { AnalyzerPlugin } from "../types.js";

/**
 * Normalizes backslashes to forward slashes for cross-platform regex matching.
 */
function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/**
 * Broad regex for E2E configs, spec files, support/fixture utilities, and page objects.
 */
const E2E_PATH_REGEX = /(?:playwright\.config|cypress\.config|wdio\.conf|nightwatch\.conf|\/e2e\/|\/tests\/e2e\/|cypress\/|\.(?:spec|cy|e2e|e2e-spec|page)\.[jt]sx?$|\/pages\/|\/fixtures\/|\/support\/)/i;

export const E2EPlugin: AnalyzerPlugin = {
  name: "e2e-plugin",
  version: "1.1.0",

  /**
   * Detects Playwright, Cypress, WebdriverIO, Nightwatch, TestCafe, Puppeteer, or Detox.
   */
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (!pkg) return false;

    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const e2ePackages = [
      "@playwright/test",
      "cypress",
      "webdriverio",
      "@wdio/cli",
      "nightwatch",
      "testcafe",
      "puppeteer",
      "detox"
    ];

    return e2ePackages.some((pkgName) => pkgName in deps);
  },

  lifecycle: {
    /**
     * Inspects package.json scripts for E2E runner invocations.
     */
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (pkg?.scripts) {
        const e2eRunners = ["playwright", "cypress", "wdio", "nightwatch", "testcafe", "detox"];
        for (const [name, script] of Object.entries(pkg.scripts)) {
          if (typeof script === "string" && e2eRunners.some((runner) => script.includes(runner))) {
            adapter.markAsUsed("package.json", `scripts:${name}`);
          }
        }
      }
    },

    /**
     * Marks E2E configs, specs, support files, and page objects as used.
     */
    onFileStart: (fileId, adapter) => {
      const normalizedFileId = normalizePath(fileId);
      if (E2E_PATH_REGEX.test(normalizedFileId)) {
        adapter.markAsUsed(fileId);
      }
    },
  },
};

export default E2EPlugin;