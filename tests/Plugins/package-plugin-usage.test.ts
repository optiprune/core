import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("generic package plugin usage", () => {
  it("does not treat a declared package as used without an observed usage site", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-package-plugin-"));
    temporaryDirectories.push(rootDir);

    await fs.writeFile(
      path.join(rootDir, "package.json"),
      JSON.stringify({
        name: "declared-but-unused-package",
        dependencies: { fooi: "^1.0.0" },
      }),
    );
    await fs.writeFile(path.join(rootDir, "index.ts"), "export const value = 1;\n");

    const report = await analyze({
      rootDir,
      entry: ["index.ts"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
      failOn: "none",
    });

    expect(
      report.findings.some(
        (finding) => finding.rule === "unused-dependency" && finding.evidence.package === "fooi",
      ),
    ).toBe(true);
  });
});
