import { describe, expect, it } from "vitest";
import path from "pathe";
import { fileURLToPath } from "node:url";
import { analyze } from "../../src/index.js";

const fixtures = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/plugins/capacitor-coverage-edge-cases",
);

async function analyzeFixture(name: string) {
  return analyze({
    rootDir: path.join(fixtures, name),
    entry: [],
    extensions: [".js", ".mjs", ".ts", ".kt", ".java", ".swift", ".gradle", ".podspec"],
    includeConventionalEntries: true,
    reportUnusedExports: true,
    reportUnusedExportsInUnreachableFiles: true,
    failOn: "none",
  });
}

function capacitorFindings(report: Awaited<ReturnType<typeof analyze>>, rule: string) {
  return report.findings.filter((finding) => finding.rule === rule);
}

describe("Capacitor plugin fixtures", () => {
  it("tracks bridge contracts and reports phantom and orphan native methods", async () => {
    const report = await analyzeFixture("fixture-1-bridge-contract");
    const methods = capacitorFindings(report, "capacitor-orphaned-native-method");
    expect(methods.some((finding) => finding.message.includes("phantomBridge"))).toBe(true);
    expect(methods.some((finding) => finding.message.includes("orphanNative"))).toBe(true);
    expect(methods.some((finding) => finding.message.includes("liveMethod"))).toBe(false);
  });

  it("keeps dynamic WebPlugin registration and ignores unimplemented stubs", async () => {
    const report = await analyzeFixture("fixture-2-web-fallback");
    expect(capacitorFindings(report, "plugin-error")).toHaveLength(0);
    expect(
      report.findings.some(
        (finding) => finding.file.endsWith("web.ts") && finding.rule === "unreachable-file",
      ),
    ).toBe(false);
  });

  it("matches native emissions with typed listeners and reports mismatched channels", async () => {
    const report = await analyzeFixture("fixture-3-events");
    expect(
      capacitorFindings(report, "capacitor-untriggered-event").some((finding) =>
        finding.message.includes("deadEvent"),
      ),
    ).toBe(true);
    expect(
      capacitorFindings(report, "capacitor-orphaned-event").some((finding) =>
        finding.message.includes("legacyEvent"),
      ),
    ).toBe(true);
    expect(
      capacitorFindings(report, "capacitor-orphaned-event").some((finding) =>
        finding.message.includes("myPluginEvent"),
      ),
    ).toBe(false);
  });

  it("protects lifecycle and permission callbacks while reporting private dead helpers", async () => {
    const report = await analyzeFixture("fixture-4-lifecycle");
    const methods = capacitorFindings(report, "capacitor-orphaned-native-method");
    expect(methods.some((finding) => finding.message.includes("trulyDeadHelper"))).toBe(true);
    expect(
      methods.some((finding) => /handleOn|permissionCallback|load/.test(finding.message)),
    ).toBe(false);
  });

  it("keeps active public typings while exposing obsolete exported contracts", async () => {
    const report = await analyzeFixture("fixture-5-typings");
    const unused = report.findings.filter((finding) => finding.rule === "unused-export");
    expect(
      unused.some(
        (finding) =>
          finding.file.endsWith("definitions.ts") && finding.message.includes("DeprecatedOptions"),
      ),
    ).toBe(true);
  });

  it("does not report native files as uncompiled when Gradle uses standard source-set wiring", async () => {
    const report = await analyzeFixture("fixture-6-manifest");
    expect(capacitorFindings(report, "capacitor-uncompiled-native-file")).toHaveLength(0);
  });
});
