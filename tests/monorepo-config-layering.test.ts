import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/index.js";

const fixtureRoot = fileURLToPath(new URL("./fixtures/monorepo-config-layering", import.meta.url));

describe("monorepo configuration layering", () => {
  it("combines root defaults with the nearest package configuration without leaking package rules", async () => {
    const report = await analyze({
      rootDir: fixtureRoot,
      includeConventionalEntries: false,
      reportUnusedExports: false,
      layers: { skip3: true, skip4: true },
    });

    expect(report.entryPoints).toEqual(expect.arrayContaining([
      "src/index.ts",
      "packages/app/src/main.ts",
      "packages/lib/src/index.ts",
    ]));

    const unusedPackages = report.findings
      .filter((finding) => finding.rule === "unused-dependency" || finding.rule === "unused-dev-dependency")
      .map((finding) => String(finding.evidence.package))
      .sort();
    expect(unusedPackages).toEqual(["app-unused", "lib-unused", "root-unused"]);

    const unreachableFiles = report.findings
      .filter((finding) => finding.rule === "unreachable-file")
      .map((finding) => String(finding.file));
    expect(unreachableFiles.some((file) => file.endsWith("root-generated/dead.ts"))).toBe(false);
    expect(unreachableFiles.some((file) => file.endsWith("packages/app/generated/dead.ts"))).toBe(false);
    expect(unreachableFiles.some((file) => file.endsWith("packages/lib/generated/dead.ts"))).toBe(true);
  });
});
