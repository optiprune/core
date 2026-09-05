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

describe("package plugin configuration discovery", () => {
  it("protects a detected config file without treating the package declaration as usage", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-package-config-"));
    temporaryDirectories.push(rootDir);
    await fs.writeFile(
      path.join(rootDir, "package.json"),
      JSON.stringify({ name: "nodemon-config-project", devDependencies: { nodemon: "^3.0.0" } }),
    );
    await fs.writeFile(path.join(rootDir, "nodemon.json"), JSON.stringify({ ext: "ts" }));
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
        (finding) => finding.rule === "unreachable-file" && finding.file.endsWith("/nodemon.json"),
      ),
    ).toBe(false);
  });
});
