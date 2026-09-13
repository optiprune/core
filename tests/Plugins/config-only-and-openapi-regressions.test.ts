import { describe, expect, it } from "vitest";
import { ReleaseItPlugin } from "../../src/plugins/release-it-plugin.js";
import { SemanticReleasePlugin } from "../../src/plugins/semantic-release-plugin.js";
import { TypeDocPlugin } from "../../src/plugins/typedoc-plugin.js";
import { PrismaPlugin } from "../../src/plugins/prisma-plugin.js";
import { analyzeFixture, runPluginFixture } from "./fixture-utils.js";

describe("configuration-only integration regressions", () => {
  it.each([
    ["release-it-config-only", ReleaseItPlugin],
    ["semantic-release-config-only", SemanticReleasePlugin],
    ["typedoc-config-only", TypeDocPlugin],
    ["prisma-schema-only", PrismaPlugin],
  ])("detects %s without source imports or CLI scripts", async (fixtureName, plugin) => {
    const result = await runPluginFixture(fixtureName, plugin);
    expect(result.detected).toBe(true);
  });
});

describe("root OpenAPI regression", () => {
  it("analyzes a root openapi.yaml and reports its unused schema", async () => {
    const report = await analyzeFixture("openapi-root");
    expect(
      report.findings.some(
        (finding) =>
          finding.rule === "unused-openapi-schema" &&
          finding.file === "openapi.yaml" &&
          finding.message.includes("Unused"),
      ),
    ).toBe(true);
  });
});
