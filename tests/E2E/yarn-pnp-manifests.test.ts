import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyze } from "../../src/index.js";

const fixtureRoot = fileURLToPath(new URL("../fixtures/e2e/yarn-pnp-manifests/", import.meta.url));

describe("Yarn PnP package manifests", () => {
  it("resolves package manifests from Yarn PnP unplugged storage", async () => {
    const report = await analyze({
      rootDir: fixtureRoot,
      entry: ["src/index.ts"],
      extensions: [".ts"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
      layers: { skip3: true, skip4: true, skipSmt: true },
    });

    const unusedPnpCli = report.findings.find(
      (finding) =>
        finding.rule === "unused-dev-dependency" &&
        finding.evidence?.package === "pnp-cli-provider",
    );
    expect(unusedPnpCli).toBeUndefined();
    expect(report.rootDir).toBe(fixtureRoot.replace(/\/$/, ""));
  });
});
