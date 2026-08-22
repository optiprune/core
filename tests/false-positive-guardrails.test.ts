import { promises as fs } from "node:fs";
import os from "node:os";
import path from "pathe";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { applyFixes } from "../src/fixer.js";
import { analyze } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(__dirname, "fixtures", "false-positive-guardrails");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function copyFixture(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `optiprune-${name}-`));
  temporaryRoots.push(root);
  await fs.cp(path.join(fixturesRoot, name), root, { recursive: true });
  return root;
}

function isFinding(report: Awaited<ReturnType<typeof analyze>>, rule: string, predicate: (finding: (typeof report.findings)[number]) => boolean): boolean {
  return report.findings.some((finding) => finding.rule === rule && predicate(finding));
}

describe("false-positive guardrails", () => {
  it("resolves project-local package.json imports aliases as source modules", async () => {
    const root = await copyFixture("package-imports");
    const report = await analyze({ rootDir: root, extensions: [".js"], layers: { skip3: true, skip4: true } });

    expect(isFinding(report, "missing-dependency", (finding) => finding.evidence.package === "#config")).toBe(false);
    expect(isFinding(report, "unreachable-file", (finding) => finding.file.endsWith("src/config.js"))).toBe(false);
  });

  it("treats require.resolve as concrete dependency usage", async () => {
    const root = await copyFixture("require-resolve");
    const report = await analyze({ rootDir: root, extensions: [".cjs"], layers: { skip3: true, skip4: true } });

    expect(isFinding(report, "unused-dependency", (finding) => finding.evidence.package === "fixture-tool")).toBe(false);
  });

  it("uses TypeScript runner targets and local Node preloads as runtime entry points", async () => {
    const root = await copyFixture("script-runners");
    const report = await analyze({ rootDir: root, extensions: [".tsx", ".mjs"], layers: { skip3: true, skip4: true } });

    expect(report.summary.entryPoints).toBe(3);
    for (const suffix of ["scripts/seed.tsx", "scripts/register.mjs", "scripts/main.mjs"]) {
      expect(isFinding(report, "unreachable-file", (finding) => finding.file.endsWith(suffix))).toBe(false);
    }
  });

  it("reports dependencies used only by unreachable files, but leaves them installed when files are retained", async () => {
    const root = await copyFixture("conditional-dependencies");
    const report = await analyze({ rootDir: root, extensions: [".ts"], layers: { skip3: true, skip4: true } });

    for (const dependency of ["only-dead", "only-dead-tool"]) {
      const finding = report.findings.find((candidate) =>
        (candidate.rule === "unused-dependency" || candidate.rule === "unused-dev-dependency") &&
        candidate.evidence.package === dependency,
      );
      expect(finding?.evidence.onlyUsedByUnreachableFiles).toBe(true);
      expect(finding?.evidence.removalRequiresFiles).toEqual([path.join(root, "src", "dead.ts")]);
    }

    expect(await applyFixes(report, root, { rules: ["dependencies", "devDependencies"], confidence: "medium+" })).toBe(0);
    const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
    expect(packageJson.dependencies["only-dead"]).toBe("1.0.0");
    expect(packageJson.devDependencies["only-dead-tool"]).toBe("1.0.0");
  });

  it("removes conditionally unused dependencies only with their supporting unreachable file or after it is absent", async () => {
    const root = await copyFixture("conditional-dependencies");
    const report = await analyze({ rootDir: root, extensions: [".ts"], layers: { skip3: true, skip4: true } });

    expect(await applyFixes(report, root, {
      rules: ["files", "dependencies", "devDependencies"],
      confidence: "medium+",
    })).toBe(3);
    expect(await fs.access(path.join(root, "src", "dead.ts")).then(() => true, () => false)).toBe(false);
    const afterJointFix = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
    expect(afterJointFix.dependencies["only-dead"]).toBeUndefined();
    expect(afterJointFix.devDependencies["only-dead-tool"]).toBeUndefined();

    const alreadyRemovedRoot = await copyFixture("conditional-dependencies");
    const alreadyRemovedReport = await analyze({ rootDir: alreadyRemovedRoot, extensions: [".ts"], layers: { skip3: true, skip4: true } });
    await fs.rm(path.join(alreadyRemovedRoot, "src", "dead.ts"));
    expect(await applyFixes(alreadyRemovedReport, alreadyRemovedRoot, {
      rules: ["dependencies", "devDependencies"],
      confidence: "medium+",
    })).toBe(2);
    const afterPriorRemoval = JSON.parse(await fs.readFile(path.join(alreadyRemovedRoot, "package.json"), "utf8"));
    expect(afterPriorRemoval.dependencies["only-dead"]).toBeUndefined();
    expect(afterPriorRemoval.devDependencies["only-dead-tool"]).toBeUndefined();
  });
});
