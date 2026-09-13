import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "pathe";
import { analyze } from "../../src/index.js";

const roots: string[] = [];

async function makeFixture(): Promise<string> {
  const root = path.resolve(
    process.cwd(),
    `temp-native-node-runner-${process.pid}-${roots.length}`,
  );
  roots.push(root);
  await fs.mkdir(path.join(root, "__tests__"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "native-node-runner-fixture",
      type: "module",
      scripts: { test: "node --test" },
    }),
  );
  await fs.writeFile(
    path.join(root, "__tests__", "native.test.ts"),
    "import test from 'node:test'; test('native', () => {});",
  );
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("native Node test-runner plugin regressions", () => {
  it("does not activate Jest or Vitest from a generic __tests__ directory", async () => {
    const rootDir = await makeFixture();
    const report = await analyze({ rootDir, entry: ["__tests__/native.test.ts"] });
    const runnerFindings = report.findings.filter(
      (finding) => finding.rule === "missing-dependency" && /Jest|Vitest/.test(finding.message),
    );
    expect(runnerFindings).toHaveLength(0);
  });
});
