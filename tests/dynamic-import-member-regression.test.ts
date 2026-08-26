import fs from "node:fs/promises";
import os from "node:os";
import path from "pathe";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function createFixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-dynamic-member-regression-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return root;
}

describe("dynamic import member regression", () => {
  it("does not report members of an object exported by a dynamically imported module", async () => {
    const root = await createFixture({
      "src/index.ts": "const loaded = await import('./dynamic-module');\nconsole.log(loaded);\n",
      "src/dynamic-module.ts": "export const runtimeConfig = { onlyLoadedDynamically: true };\n",
    });

    const result = await analyze({
      rootDir: root,
      entry: ["src/index.ts"],
      includeConventionalEntries: false,
      skip3: true,
      skip4: true,
    });

    expect(result.findings).not.toContainEqual(
      expect.objectContaining({
        rule: "unused-member",
        evidence: expect.objectContaining({ memberName: "onlyLoadedDynamically" }),
      }),
    );
  });
});
