import fs from "node:fs/promises";
import os from "node:os";
import path from "pathe";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config-loader.js";
import { PluginEngine } from "../../src/engine.js";
import { contextWithGraph } from "../../src/graph.js";
import { analyze } from "../../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function rootWith(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-config-files-"));
  roots.push(root);
  for (const [file, contents] of Object.entries(files)) {
    const target = path.join(root, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf8");
  }
  return root;
}

describe("configFiles", () => {
  it("protects matching files from all findings without turning them into entry points", async () => {
    const root = await rootWith({
      "package.json": JSON.stringify({ name: "config-files-test", private: true }),
      "src/index.ts": [
        'import { toolSettings } from "../tooling/used";',
        "console.log(toolSettings.used);",
      ].join("\n"),
      "tooling/used.ts": [
        'import "./missing-config-dependency";',
        "export const toolSettings = { used: true, unused: true };",
        "export const unusedExport = true;",
        "export function configFlow() { return; console.log('unreachable'); }",
      ].join("\n"),
      "tooling/orphan.ts": "export const orphan = true;\n",
    });
    const options = {
      rootDir: root,
      entry: ["src/index.ts"],
      includeConventionalEntries: false,
      includeEntryMembers: true,
      reportUnusedExportsInUnreachableFiles: true,
      skip3: true,
      skip4: true,
    };

    const unprotected = await analyze(options);
    const unprotectedRules = unprotected.findings
      .filter((finding) => String(finding.file).includes(`${path.sep}tooling${path.sep}`))
      .map((finding) => finding.rule);
    expect(unprotectedRules).toEqual(
      expect.arrayContaining([
        "unreachable-file",
        "unused-export",
        "unused-member",
        "unreachable-statement",
        "unresolved-import",
      ]),
    );

    const protectedReport = await analyze({ ...options, configFiles: ["tooling/**/*.ts"] });
    expect(protectedReport.modules.map((module) => module.path)).toEqual(
      expect.arrayContaining(["tooling/used.ts", "tooling/orphan.ts"]),
    );
    expect(protectedReport.entryPoints).toEqual(["src/index.ts"]);
    expect(
      protectedReport.findings.some((finding) =>
        String(finding.file).includes(`${path.sep}tooling${path.sep}`),
      ),
    ).toBe(false);
  });

  it("lets plugins protect a discovered config file without adding reachability or an entry point", () => {
    const root = "/tmp/optiprune-plugin-config-files";
    const context = contextWithGraph(new Map(), new Set(), { ...DEFAULT_CONFIG, rootDir: root });
    const adapter = new PluginEngine().createAdapter(context);

    adapter.markConfigFileAsUsed("tooling/discovered.ts");

    const file = path.join(root, "tooling/discovered.ts");
    expect(context.protectedConfigFiles.has(file)).toBe(true);
    expect(context.options.configFiles).toContain(file);
    expect(context.entryPoints.has(file)).toBe(false);
    expect(context.reachable.has(file)).toBe(false);
  });
});
