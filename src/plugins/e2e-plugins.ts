import { AnalyzerPlugin } from "../types.js";

/**
 * Regex zur Erkennung von E2E-bezogenen Dateien:
 * - Konfigurationsdateien (playwright.config, cypress.config)
 * - Verzeichnisse (/e2e/, /tests/e2e/, cypress/)
 * - Test-Dateien (*.spec.ts, *.e2e-spec.ts, etc.)
 */
const E2E_PATH_REGEX = /(playwright\.config|cypress\.config|\/e2e\/|\/tests\/e2e\/|cypress\/|\.(spec|e2e-spec)\.[jt]sx?$)/;

export const E2EPlugin: AnalyzerPlugin = {
  name: "e2e-plugin",
  version: "1.0.0",

  /**
   * Erkennt, ob Playwright oder Cypress im Projekt vorhanden sind.
   */
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (!pkg) return false;

    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return "@playwright/test" in deps || "cypress" in deps;
  },

  lifecycle: {
    /**
     * Wird für jede Datei im Projekt aufgerufen.
     * Wenn die Datei dem E2E-Muster entspricht, wird sie als "benutzt" markiert.
     */
    onFileStart: (fileId, adapter) => {
      if (E2E_PATH_REGEX.test(fileId)) {
        adapter.markAsUsed(fileId);
      }
    },
  },
};

export default E2EPlugin;
