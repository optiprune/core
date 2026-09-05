import fs from "node:fs/promises";
import os from "node:os";
import path from "pathe";
import { expect } from "vitest";
import { analyze } from "../../src/index.js";
import { parseModule } from "../../src/parser.js";

export async function fixture(
  files: Record<string, string>,
  dependencies: Record<string, string> = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-compilers-"));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "fixture", dependencies }),
  );
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
  }
  return root;
}

export async function report(root: string, entry = "src/index.ts") {
  return analyze({
    rootDir: root,
    entry: [entry],
    reportUnusedExports: false,
    includeConventionalEntries: false,
    layers: { skip3: true, skip4: true, skipSmt: true },
  });
}

export function edgeSpecifiers(source: string, file = "src/style.scss") {
  return parseModule(source, file).edges.map((edge) => edge.rawSpecifier);
}

export function expectNoUnused(
  reportResult: Awaited<ReturnType<typeof report>>,
  packageName: string,
) {
  expect(
    reportResult.findings.some(
      (finding) => finding.rule === "unused-dependency" && finding.evidence.package === packageName,
    ),
  ).toBe(false);
}
