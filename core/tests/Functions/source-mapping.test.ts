import { promises as fs } from "node:fs";
import os from "node:os";
import path from "pathe";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../../src/index.js";
import { discoverPackageScriptTargets } from "../../src/fs-utils.js";
import {
  STANDARD_SOURCE_EXTENSIONS,
  loadSourceMappings,
  sourceCandidatesForOutput,
  stripOutputExtension,
  toSourceMappedSpecifiers,
  type SourceMapping,
} from "../../src/source-mapping.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function rootWith(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-source-mapping-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return root;
}

const mapping: SourceMapping = {
  srcDir: "/project/src",
  outDir: "/project/dist",
  sourceExtensions: STANDARD_SOURCE_EXTENSIONS,
  compilerExtensions: [".foo"],
};

describe("source mapping candidates", () => {
  it("maps a .jsx build artifact back to its .tsx source", () => {
    expect(toSourceMappedSpecifiers("/project/dist/index.jsx", mapping)[0]).toBe(
      "/project/src/index.tsx",
    );
    expect(sourceCandidatesForOutput("/project/dist/index.jsx", mapping)).toContain(
      "/project/src/index.tsx",
    );
  });

  it("maps a .js artifact back to its .ts source", () => {
    expect(toSourceMappedSpecifiers("/project/dist/index.js", mapping)[0]).toBe(
      "/project/src/index.ts",
    );
  });

  it("includes custom compiler extensions after the standard ones", () => {
    const candidates = toSourceMappedSpecifiers("/project/dist/index.js", mapping);
    expect(candidates).toContain("/project/src/index.foo");
    expect(candidates.indexOf("/project/src/index.ts")).toBeLessThan(
      candidates.indexOf("/project/src/index.foo"),
    );
  });

  it("preserves nested directories and strips declaration extensions", () => {
    expect(stripOutputExtension("features/panel.d.ts")).toBe("features/panel");
    expect(toSourceMappedSpecifiers("/project/dist/features/panel.js", mapping)).toContain(
      "/project/src/features/panel.ts",
    );
  });

  it("ignores paths outside the output directory", () => {
    expect(toSourceMappedSpecifiers("/project/lib/index.js", mapping)).toEqual([]);
    expect(toSourceMappedSpecifiers("/project/dist/README.md", mapping)).toEqual([]);
  });
});

describe("source mapping configuration", () => {
  it("derives srcDir/outDir from tsconfig and keeps custom compiler extensions", async () => {
    const root = await rootWith({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { rootDir: "src", outDir: "dist", sourceExtensions: [".foo"] },
      }),
    });
    const mappings = await loadSourceMappings(root, { extensions: [".ts", ".foo"] });
    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toMatchObject({
      srcDir: path.join(root, "src"),
      outDir: path.join(root, "dist"),
    });
    expect(mappings[0].compilerExtensions).toEqual(expect.arrayContaining([".foo"]));
    expect(sourceCandidatesForOutput(path.join(root, "dist", "index.js"), mappings[0])).toContain(
      path.join(root, "src", "index.foo"),
    );
  });

  it("honors an explicit sourceMapping override", async () => {
    const root = await rootWith({ "README.md": "# project\n" });
    const mappings = await loadSourceMappings(root, {
      sourceMapping: { outDir: "build", srcDir: "lib", compilerExtensions: [".mdx"] },
    });
    expect(mappings).toHaveLength(1);
    expect(sourceCandidatesForOutput(path.join(root, "build", "entry.js"), mappings[0])).toContain(
      path.join(root, "lib", "entry.mdx"),
    );
  });
});

describe("source mapping integration", () => {
  it("resolves a .jsx package entry back to its .tsx source", async () => {
    const root = await rootWith({
      "package.json": JSON.stringify({
        name: "jsx-dist-source-map",
        private: true,
        exports: { ".": "./dist/index.jsx" },
      }),
      "tsconfig.json": JSON.stringify({ compilerOptions: { rootDir: "src", outDir: "dist" } }),
      "src/index.tsx": "export const App = () => <main>ok</main>;\n",
    });
    const report = await analyze({
      rootDir: root,
      entry: [],
      extensions: [".ts", ".tsx"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
    });
    expect(report.entryPoints).toContain("src/index.tsx");
    expect(
      report.findings.some(
        (finding) => finding.rule === "unreachable-file" && finding.file.endsWith("index.tsx"),
      ),
    ).toBe(false);
  });

  it("resolves a .js package entry back to a custom compiler source", async () => {
    const root = await rootWith({
      "package.json": JSON.stringify({
        name: "custom-compiler-source-map",
        private: true,
        exports: { ".": "./dist/index.js" },
      }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: { rootDir: "src", outDir: "dist", sourceExtensions: [".foo"] },
      }),
      "src/index.foo": "export const compiled = true;\n",
    });
    const report = await analyze({
      rootDir: root,
      entry: [],
      extensions: [".ts", ".foo"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
    });
    expect(report.entryPoints).toContain("src/index.foo");
    expect(
      report.findings.some(
        (finding) => finding.rule === "unreachable-file" && finding.file.endsWith("index.foo"),
      ),
    ).toBe(false);
  });

  it("maps a node script target that points at a .jsx build output", async () => {
    const root = await rootWith({
      "package.json": JSON.stringify({
        name: "jsx-script-target",
        private: true,
        scripts: { start: "node dist/cli.jsx" },
      }),
      "tsconfig.json": JSON.stringify({ compilerOptions: { rootDir: "src", outDir: "dist" } }),
      "src/cli.tsx": "export const cli = () => <div />;\n",
    });
    const targets = await discoverPackageScriptTargets(root, [".tsx"]);
    const target = targets.find((candidate) => candidate.scriptName === "start");
    expect(target?.exists).toBe(true);
    expect(target?.relativePath).toBe("src/cli.tsx");
  });
});
