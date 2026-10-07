import { promises as fs } from "node:fs";
import os from "node:os";
import path from "pathe";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../../src/index.js";
import type { AnalysisReport } from "../../src/types.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function rootWith(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-tags-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return root;
}

function unusedExports(report: AnalysisReport) {
  return report.findings
    .filter((finding) => finding.rule === "unused-export")
    .map((finding) => ({
      file: path.basename(finding.file),
      name: String(finding.evidence.exportName),
    }));
}

describe("unused tag hints on members", () => {
  it("hints only for tagged members that are referenced anyway", async () => {
    const root = await rootWith({
      "package.json": JSON.stringify({ name: "tag-on-member", private: true }),
      "src/fruit.ts": [
        "export enum Fruit {",
        "  /** @knipignore */",
        '  apple = "apple",',
        '  banana = "banana",',
        "  /** @knipignore */",
        '  cherry = "cherry",',
        "}",
        "",
        "export namespace Basket {",
        "  /** @knipignore */",
        "  export const size = 1;",
        '  export const color = "red";',
        "}",
        "",
      ].join("\n"),
      "src/main.ts": [
        'import { Fruit, Basket } from "./fruit";',
        "console.log(Fruit.apple, Fruit.banana, Basket.size, Basket.color);",
        "",
      ].join("\n"),
    });

    const report = await analyze({
      rootDir: root,
      entry: ["src/main.ts"],
      extensions: [".ts"],
      includeConventionalEntries: false,
      includeEntryExports: true,
      reportUnusedExports: true,
      tagHints: { knipignore: "ignore" },
    });

    const hinted = (report.hints ?? []).map((hint) => hint.symbol).sort();
    expect(hinted).toEqual(["Basket.size", "Fruit.apple"]);
    expect(report.hints?.every((hint) => hint.tag === "knipignore")).toBe(true);

    // A tagged but genuinely unused member is exempt from the member check and
    // must not produce a hint either.
    expect(
      report.findings.filter(
        (finding) => finding.rule === "unused-member" && finding.file.endsWith("fruit.ts"),
      ),
    ).toEqual([]);
  });

  it("does not hint for an untagged export that is referenced", async () => {
    const root = await rootWith({
      "package.json": JSON.stringify({ name: "no-tag", private: true }),
      "src/mod.ts": "export const value = 1;\n",
      "src/main.ts": 'import { value } from "./mod";\nconsole.log(value);\n',
    });

    const report = await analyze({
      rootDir: root,
      entry: ["src/main.ts"],
      extensions: [".ts"],
      includeConventionalEntries: false,
      reportUnusedExports: true,
    });

    expect(report.hints ?? []).toEqual([]);
  });
});

describe("tags on entry re-exports", () => {
  const entryExportOptions = {
    extensions: [".ts"],
    includeConventionalEntries: false,
    includeEntryExports: true,
    reportUnusedExports: true,
  } as const;

  it("case 1: an unrelated tagged entry export does not hide the origin export", async () => {
    const root = await rootWith({
      "package.json": JSON.stringify({ name: "reexport-case-1", private: true }),
      "index.ts": [
        'export { default as Button } from "./button";',
        "",
        "/** @public */",
        "export default function App() {}",
        "",
      ].join("\n"),
      "button.ts": "export default function Button() {}\n",
    });

    const report = await analyze({ rootDir: root, entry: ["index.ts"], ...entryExportOptions });
    const names = unusedExports(report);
    expect(names).toContainEqual({ file: "index.ts", name: "Button" });
    // The origin export must be reported. OptiPrune collapses a file whose only
    // exports are unused and which has no top-level runtime logic into a single
    // unreachable-file finding, so either rule proves the tag on the unrelated
    // entry export did not hide it.
    expect(
      report.findings.some(
        (finding) =>
          finding.file.endsWith("button.ts") &&
          (finding.rule === "unreachable-file" ||
            (finding.rule === "unused-export" && finding.evidence.exportName === "default")),
      ),
    ).toBe(true);
  });

  it("case 2: a tag on a renamed re-export protects the origin export", async () => {
    const root = await rootWith({
      "package.json": JSON.stringify({ name: "reexport-case-2", private: true }),
      "index.ts": '/** @public */\nexport { apple as green } from "./module";\n',
      "module.ts": "export const apple = 1;\n",
    });

    const report = await analyze({ rootDir: root, entry: ["index.ts"], ...entryExportOptions });
    expect(unusedExports(report)).not.toContainEqual({ file: "module.ts", name: "apple" });
  });

  it("case 3: one tagged alias protects an export re-exported twice", async () => {
    const root = await rootWith({
      "package.json": JSON.stringify({ name: "reexport-case-3", private: true }),
      "index.ts": [
        "/** @public */",
        'export { pear } from "./module";',
        "",
        'export { pear as fruit } from "./module";',
        "",
      ].join("\n"),
      "module.ts": "export const pear = 1;\n",
    });

    const report = await analyze({ rootDir: root, entry: ["index.ts"], ...entryExportOptions });
    expect(unusedExports(report)).not.toContainEqual({ file: "module.ts", name: "pear" });
  });

  it("case 4: the tagged alias route survives an intermediate barrel", async () => {
    const root = await rootWith({
      "package.json": JSON.stringify({ name: "reexport-case-4", private: true }),
      "index.ts": [
        "/** @public */",
        'export { plum } from "./barrel";',
        "",
        'export { prune } from "./barrel";',
        "",
      ].join("\n"),
      "barrel.ts": 'export { plum, plum as prune } from "./module";\n',
      "module.ts": "export const plum = 1;\n",
    });

    const report = await analyze({ rootDir: root, entry: ["index.ts"], ...entryExportOptions });
    expect(unusedExports(report)).not.toContainEqual({ file: "module.ts", name: "plum" });
  });

  it("case 4 with a non-entry consumer of the untagged alias", async () => {
    const root = await rootWith({
      "package.json": JSON.stringify({ name: "reexport-case-4b", private: true }),
      "index.ts": '/** @public */\nexport { plum } from "./barrel";\n',
      "barrel.ts": 'export { plum, plum as prune } from "./module";\n',
      "consumer.ts": 'import { prune } from "./barrel";\nconsole.log(prune);\n',
      "module.ts": "export const plum = 1;\n",
    });

    const report = await analyze({
      rootDir: root,
      entry: ["index.ts", "consumer.ts"],
      ...entryExportOptions,
    });
    expect(unusedExports(report)).not.toContainEqual({ file: "module.ts", name: "plum" });
  });

  it("case 2 with an excluded custom tag", async () => {
    const root = await rootWith({
      "package.json": JSON.stringify({ name: "reexport-excluded-tag", private: true }),
      "index.ts": '/** @lintignore */\nexport { apple as green } from "./module";\n',
      "module.ts": "export const apple = 1;\n",
    });

    const report = await analyze({
      rootDir: root,
      entry: ["index.ts"],
      ...entryExportOptions,
      tagHints: { lintignore: "ignore" },
    });
    expect(unusedExports(report)).not.toContainEqual({ file: "module.ts", name: "apple" });
  });
});
