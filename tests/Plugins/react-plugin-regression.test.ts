import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyze } from "../../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("react-plugin reachability", () => {
  it("does not promote an unimported React component to reachable", async () => {
    const rootDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "optiprune-react-"),
    );
    temporaryDirectories.push(rootDir);

    await fs.writeFile(
      path.join(rootDir, "package.json"),
      JSON.stringify({
        name: "react-reachability-fixture",
        dependencies: { react: "^19.0.0" },
      }),
    );
    await fs.writeFile(
      path.join(rootDir, "main.tsx"),
      'import { App } from "./App";\nconsole.log(App);\n',
    );
    await fs.writeFile(
      path.join(rootDir, "App.tsx"),
      'import React from "react";\nexport function App() { return <div />; }\n',
    );
    await fs.writeFile(
      path.join(rootDir, "accordion.tsx"),
      'import * as React from "react";\nexport const Accordion = () => <div />;\n',
    );

    const report = await analyze({
      rootDir,
      entry: ["main.tsx"],
      extensions: [".ts", ".tsx"],
      includeConventionalEntries: false,
      reportUnusedExports: true,
      ignore: [],
    });

    expect(
      report.findings.some(
        (finding) =>
          finding.rule === "unreachable-file" &&
          finding.file.endsWith("accordion.tsx"),
      ),
    ).toBe(true);
    expect(
      report.findings.some(
        (finding) =>
          finding.rule === "unused-export" &&
          finding.file.endsWith("accordion.tsx"),
      ),
    ).toBe(false);
  });
});
