/**
 * Regression tests: TypeScript type-only exports are now reported if truly unused.
 *
 * Fix 3 Update:
 * Previously, all type-only exports were unconditionally skipped to avoid false positives
 * because local references were not tracked. Now that we track local references,
 * we can safely report unused types.
 */

import { describe, it, expect } from "vitest";
import path from "pathe";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { analyze } from "../../src/index.js";
import { parseModule } from "../../src/parser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function withTempDir(
  files: Record<string, string>,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-ts-type-only-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      const filePath = path.join(dir, name);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf8");
    }
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("Parser: isTypeOnly flag", () => {
  it("marks TSInterfaceDeclaration exports as isTypeOnly", () => {
    const src = `export interface Foo { bar: string; }`;
    const mod = parseModule(src, "test.ts");
    const exp = mod.exports.find((e) => e.exportedAs === "Foo");
    expect(exp, "export 'Foo' should be present").toBeDefined();
    expect(exp?.isTypeOnly).toBe(true);
  });

  it("marks TSTypeAliasDeclaration exports as isTypeOnly", () => {
    const src = `export type Bar = "a" | "b";`;
    const mod = parseModule(src, "test.ts");
    const exp = mod.exports.find((e) => e.exportedAs === "Bar");
    expect(exp, "export 'Bar' should be present").toBeDefined();
    expect(exp?.isTypeOnly).toBe(true);
  });

  it("marks const TSEnumDeclaration exports as isTypeOnly", () => {
    const src = `export const enum Direction { Up, Down, Left, Right }`;
    const mod = parseModule(src, "test.ts");
    const exp = mod.exports.find((e) => e.exportedAs === "Direction");
    expect(exp, "export 'Direction' should be present").toBeDefined();
    expect(exp?.isTypeOnly).toBe(true);
  });

  it("does NOT mark regular TSEnumDeclaration exports as isTypeOnly", () => {
    const src = `export enum Direction { Up, Down, Left, Right }`;
    const mod = parseModule(src, "test.ts");
    const exp = mod.exports.find((e) => e.exportedAs === "Direction");
    expect(exp, "export 'Direction' should be present").toBeDefined();
    expect(exp?.isTypeOnly).toBe(false);
  });

  it("marks `export type { … }` specifiers as isTypeOnly", () => {
    const src = `
      interface Hidden { x: number }
      export type { Hidden };
    `;
    const mod = parseModule(src, "test.ts");
    const exp = mod.exports.find((e) => e.exportedAs === "Hidden");
    expect(exp, "export 'Hidden' should be present").toBeDefined();
    expect(exp?.isTypeOnly).toBe(true);
  });

  it("does NOT mark plain value exports as isTypeOnly", () => {
    const src = `export const VERSION = "1.0.0";`;
    const mod = parseModule(src, "test.ts");
    const exp = mod.exports.find((e) => e.exportedAs === "VERSION");
    expect(exp, "export 'VERSION' should be present").toBeDefined();
    expect(exp?.isTypeOnly).toBe(false);
  });

  it("does NOT mark class exports as isTypeOnly", () => {
    const src = `export class MyService { run() {} }`;
    const mod = parseModule(src, "test.ts");
    const exp = mod.exports.find((e) => e.exportedAs === "MyService");
    expect(exp, "export 'MyService' should be present").toBeDefined();
    expect(exp?.isTypeOnly).toBe(false);
  });

  it("does NOT mark function exports as isTypeOnly", () => {
    const src = `export function doWork(): void {}`;
    const mod = parseModule(src, "test.ts");
    const exp = mod.exports.find((e) => e.exportedAs === "doWork");
    expect(exp, "export 'doWork' should be present").toBeDefined();
    expect(exp?.isTypeOnly).toBe(false);
  });
});

describe("Analyser: TypeScript type-only exports (Fix 3 Precision)", () => {
  it("DOES flag an unused interface as unused-export", async () => {
    await withTempDir(
      {
        "entry.ts": `import './types.js'; export const x = 1;`,
        "types.ts": `export interface CacheEntry { key: string; value: unknown; }`,
      },
      async (dir) => {
        const report = await analyze({
          rootDir: dir,
          entry: ["entry.ts"],
          extensions: [".ts"],
          ignore: [],
          reportUnusedExports: true,
          includeConventionalEntries: false,
        });

        const typeFindings = report.findings.filter(
          (f) => f.rule === "unused-export" && f.evidence.exportName === "CacheEntry",
        );
        expect(typeFindings, "Unused interface should now be flagged").toHaveLength(1);
      },
    );
  });

  it("DOES flag an unused type alias as unused-export", async () => {
    await withTempDir(
      {
        "entry.ts": `import './types.js'; export const x = 1;`,
        "types.ts": `export type Confidence = "high" | "medium" | "low";`,
      },
      async (dir) => {
        const report = await analyze({
          rootDir: dir,
          entry: ["entry.ts"],
          extensions: [".ts"],
          ignore: [],
          reportUnusedExports: true,
          includeConventionalEntries: false,
        });

        const typeFindings = report.findings.filter(
          (f) => f.rule === "unused-export" && f.evidence.exportName === "Confidence",
        );
        expect(typeFindings, "Unused type alias should now be flagged").toHaveLength(1);
      },
    );
  });

  it("DOES flag an unused CONST enum as unused-export", async () => {
    await withTempDir(
      {
        "entry.ts": `import './types.js'; export const x = 1;`,
        "types.ts": `export const enum Status { Active = "active", Inactive = "inactive" }`,
      },
      async (dir) => {
        const report = await analyze({
          rootDir: dir,
          entry: ["entry.ts"],
          extensions: [".ts"],
          ignore: [],
          reportUnusedExports: true,
          includeConventionalEntries: false,
        });

        const typeFindings = report.findings.filter(
          (f) => f.rule === "unused-export" && f.evidence.exportName === "Status",
        );
        expect(typeFindings, "Unused const enum should now be flagged").toHaveLength(1);
      },
    );
  });

  it("DOES flag a regular unused enum as unused-export", async () => {
    await withTempDir(
      {
        "entry.ts": `import './types.js'; export const x = 1;`,
        "types.ts": `export enum Status { Active = "active", Inactive = "inactive" }`,
      },
      async (dir) => {
        const report = await analyze({
          rootDir: dir,
          entry: ["entry.ts"],
          extensions: [".ts"],
          ignore: [],
          reportUnusedExports: true,
          includeConventionalEntries: false,
        });

        const enumFinding = report.findings.find(
          (f) => f.rule === "unused-export" && f.evidence.exportName === "Status",
        );
        expect(enumFinding, "Regular unused enum should be flagged").toBeDefined();
      },
    );
  });

  it("DOES flag an `export type { … }` re-export as unused-export", async () => {
    await withTempDir(
      {
        "entry.ts": `import './types.js'; export const x = 1;`,
        "types.ts": `
          interface DynamicPattern { prefix: string; suffix: string; }
          export type { DynamicPattern };
        `,
      },
      async (dir) => {
        const report = await analyze({
          rootDir: dir,
          entry: ["entry.ts"],
          extensions: [".ts"],
          ignore: [],
          reportUnusedExports: true,
          includeConventionalEntries: false,
        });

        const typeFindings = report.findings.filter(
          (f) => f.rule === "unused-export" && f.evidence.exportName === "DynamicPattern",
        );
        expect(typeFindings, "Unused type re-export should now be flagged").toHaveLength(1);
      },
    );
  });

  it("flags multiple unused type-only constructs", async () => {
    await withTempDir(
      {
        "entry.ts": `import './types.js'; export const x = 1;`,
        "types.ts": `
          export interface Position { line: number; column: number; }
          export type EdgeKind = "import" | "export-from" | "require";
          export const enum ParseStatus { Parsed = "parsed", Recovered = "recovered" }
          export type Nullable<T> = T | null;
        `,
      },
      async (dir) => {
        const report = await analyze({
          rootDir: dir,
          entry: ["entry.ts"],
          extensions: [".ts"],
          ignore: [],
          reportUnusedExports: true,
          includeConventionalEntries: false,
        });

        const typeOnlyNames = ["Position", "EdgeKind", "ParseStatus", "Nullable"];
        for (const name of typeOnlyNames) {
          const found = report.findings.filter(
            (f) => f.rule === "unused-export" && f.evidence.exportName === name,
          );
          expect(found, `'${name}' should be reported as unused-export`).toHaveLength(1);
        }
      },
    );
  });

  it("uses the fixture directory: all type-only exports in types.ts are now flagged if unused", async () => {
    const fixtureDir = path.join(__dirname, "..", "fixtures", "functions", "ts-type-only");

    const report = await analyze({
      rootDir: fixtureDir,
      entry: ["entry.ts"],
      extensions: [".ts"],
      ignore: [],
      reportUnusedExports: true,
      includeConventionalEntries: false,
    });

    const typeOnlyNames = ["CacheEntry", "Confidence", "Status", "DynamicPattern", "Repository"];
    for (const name of typeOnlyNames) {
      const found = report.findings.filter(
        (f) => f.rule === "unused-export" && f.evidence.exportName === name,
      );
      expect(found, `'${name}' should be reported as unused-export`).toHaveLength(1);
    }
  });
});
