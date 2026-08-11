import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "pathe";
import { analyze } from "../src/index.js";

const testDir = path.join(process.cwd(), ".tmp-react-plugin-dedup-test");

describe("React plugin project findings", () => {
  beforeAll(async () => {
    await fs.mkdir(testDir, { recursive: true });
    await fs.writeFile(
      path.join(testDir, "package.json"),
      JSON.stringify({ name: "missing-react-dependency", private: true }),
    );
    await fs.writeFile(
      path.join(testDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }),
    );
    await fs.writeFile(
      path.join(testDir, "index.tsx"),
      "export default function App() { return <div />; }\n",
    );
  });

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("does not infer React ownership from JSX compiler settings alone", async () => {
    const report = await analyze({
      rootDir: testDir,
      entry: ["index.tsx"],
      failOn: "none",
    });

    const jsxDependencyFindings = report.findings.filter(
      (finding) =>
        finding.rule === "missing-dependency" &&
        finding.message ===
          "JSX support is enabled in tsconfig/jsconfig, but 'react' is not listed in package.json dependencies.",
    );

    expect(jsxDependencyFindings).toHaveLength(0);
  });
});
