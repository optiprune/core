import { promises as fs } from "node:fs";
import os from "node:os";
import path from "pathe";
import { afterEach, describe, expect, it } from "vitest";
import { parseModule } from "../../src/parser.js";
import { analyze } from "../../src/index.js";
import { applyFixes } from "../../src/fixer.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function rootWith(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-namespace-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return root;
}

function namespaceMembers(source: string) {
  const module = parseModule(source, "ns.ts");
  return module.exports[0]?.members ?? [];
}

function refs(source: string, identifier: string): boolean | undefined {
  return namespaceMembers(source).find((member) => member.name === identifier)?.hasRefsInFile;
}

function refsByPath(source: string, memberPath: string): boolean | undefined {
  return namespaceMembers(source).find((member) => member.path === memberPath)?.hasRefsInFile;
}

describe("namespace member extraction", () => {
  it("records nested namespace members with their full path", () => {
    const members = namespaceMembers(
      `export namespace NS {\n  export namespace Sizes {\n    export type Size = "sm" | "md";\n  }\n}`,
    );
    expect(members.map((member) => member.path)).toEqual(
      expect.arrayContaining(["Sizes", "Sizes.Size"]),
    );
    expect(members.map((member) => member.name)).toEqual(expect.arrayContaining(["Sizes", "Size"]));
  });
});

describe("in-namespace references", () => {
  it("keeps a base class that a sibling extends", () => {
    const source = `export namespace NS {\n  export abstract class Base {}\n  export class Impl extends Base {}\n}`;
    expect(refs(source, "Base")).toBe(true);
    expect(refs(source, "Impl")).toBeFalsy();
  });

  it("resolves a bare identifier to a nested namespace member", () => {
    const source = `export namespace NS {\n  export namespace Sizes {\n    export type Size = "sm" | "md";\n    export const small: Size = "sm";\n  }\n}`;
    expect(refsByPath(source, "Sizes.Size")).toBe(true);
  });

  it("resolves a qualified reference from the parent namespace", () => {
    const source = `export namespace NS {\n  export namespace Sizes {\n    export type Size = "sm" | "md";\n  }\n  export const defaultSize: Sizes.Size = "sm";\n}`;
    expect(refsByPath(source, "Sizes")).toBe(true);
    expect(refsByPath(source, "Sizes.Size")).toBe(true);
  });

  it("visits a binding's type annotation but not the binding name", () => {
    const source = `export namespace NS {\n  export interface Options {\n    verbose?: boolean;\n  }\n  export const options: Options = {};\n}`;
    expect(refs(source, "Options")).toBe(true);
    expect(refs(source, "options")).toBeFalsy();
  });

  it("does not mark a sibling member through a computed-free array property", () => {
    const source = `export namespace NS {\n  export const length = 3;\n  export function size() {\n    return [1, 2].length;\n  }\n}`;
    expect(refs(source, "length")).toBeFalsy();
  });

  it("keeps a member used by an overload implementation and its callers", () => {
    const source = [
      "export namespace NS {",
      "  export function parse(value: string): number;",
      "  export function parse(value: number): string;",
      "  export function parse(value: unknown): unknown {",
      "    return value;",
      "  }",
      "  export function use() {",
      '    return parse("x");',
      "  }",
      "}",
    ].join("\n");
    expect(refs(source, "parse")).toBe(true);
  });

  it("still reports a self-recursive member as unreferenced", () => {
    const source = `export namespace NS {\n  export function spin() {\n    return spin();\n  }\n}`;
    expect(refs(source, "spin")).toBeFalsy();
  });

  it("resolves a qualified reference made from module scope", () => {
    const source = `export namespace NS {\n  export namespace Inner {\n    export type Deep = 1;\n  }\n}\nexport const value: NS.Inner.Deep = 1;`;
    expect(refsByPath(source, "Inner")).toBe(true);
    expect(refsByPath(source, "Inner.Deep")).toBe(true);
  });
});

describe("namespace member shadowing", () => {
  const source = [
    "export namespace NS {",
    "  export const value = 1;",
    "  export const width = 2;",
    "  export const height = 3;",
    "  export const depth = 4;",
    "  export function run() {",
    "    const width = 10;",
    "    { var height = 20; }",
    "    try { throw new Error(); } catch (depth) { return depth; }",
    "    let value = 100;",
    "    return [width, height, value];",
    "  }",
    "}",
  ].join("\n");

  it("treats block-scoped, hoisted, and catch bindings as shadowing", () => {
    expect(refs(source, "value")).toBeFalsy();
    expect(refs(source, "width")).toBeFalsy();
    expect(refs(source, "height")).toBeFalsy();
    expect(refs(source, "depth")).toBeFalsy();
  });

  it("shadows through a switch case and a for head", () => {
    const switchSource = [
      "export namespace NS {",
      "  export const mode = 1;",
      "  export function pick(key: number) {",
      "    switch (key) {",
      "      case 1: {",
      "        const mode = 2;",
      "        return mode;",
      "      }",
      "    }",
      "    return 0;",
      "  }",
      "}",
    ].join("\n");
    expect(refs(switchSource, "mode")).toBeFalsy();

    const forSource = [
      "export namespace NS {",
      "  export const item = 1;",
      "  export function loop(values: number[]) {",
      "    for (const item of values) {",
      "      return item;",
      "    }",
      "    return 0;",
      "  }",
      "}",
    ].join("\n");
    expect(refs(forSource, "item")).toBeFalsy();
  });

  it("shadows through a named function expression", () => {
    const source = [
      "export namespace NS {",
      "  export const self = 1;",
      "  export const holder = function self() {",
      "    return self;",
      "  };",
      "}",
    ].join("\n");
    expect(refs(source, "self")).toBeFalsy();
    expect(refs(source, "holder")).toBeFalsy();
  });
});

describe("namespace member reporting and fixing", () => {
  it("reports only members that nothing references, and never deletes live ones", async () => {
    const source = [
      "export namespace NS {",
      "  export abstract class Base {}",
      "  export class Impl extends Base {}",
      "  export function keep() {",
      "    return new Impl();",
      "  }",
      "  export const unusedValue = 1;",
      "}",
    ].join("\n");
    const root = await rootWith({
      "src/index.ts": 'import { NS } from "./ns";\nconsole.log(NS.keep());\n',
      "src/ns.ts": source,
    });

    const report = await analyze({
      rootDir: root,
      entry: ["src/index.ts"],
      extensions: [".ts", ".tsx"],
      includeConventionalEntries: false,
      reportUnusedExports: true,
      layers: { skip3: true, skip4: true },
    });

    const reportedMembers = report.findings
      .filter((finding) => finding.rule === "unused-member" && finding.file.endsWith("ns.ts"))
      .map((finding) => finding.evidence.memberName);
    expect(reportedMembers).toEqual(["unusedValue"]);

    expect(
      await applyFixes(report, root, { rules: ["exports"], confidence: "high" }),
    ).toBeGreaterThanOrEqual(0);
    const fixed = await fs.readFile(path.join(root, "src", "ns.ts"), "utf8");
    expect(fixed).toContain("class Base");
    expect(fixed).toContain("class Impl");
    expect(fixed).toContain("function keep");
  });
});
