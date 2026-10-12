import { WebContainer } from "@webcontainer/api";

const result = (value) => {
  window.__webcontainerTestResult = value;
};

const readProcessOutput = async (process) => {
  const reader = process.output.getReader();
  let output = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    output += value;
  }
  return output;
};

try {
  const coreTree = await (await fetch("/fixture/core-tree.json")).json();
  const packageJson = {
    name: "optiprune-webcontainer-fixture",
    private: true,
    type: "module",
    dependencies: {
      "@optiprune/core": "file:./local-core",
    },
  };
  const checkScript = `
    import { analyze } from "@optiprune/core";
    const report = await analyze({
      rootDir: process.cwd(),
      entry: ["src/index.ts"],
      failOn: "none",
      skipSmt: true,
    });
    const backends = [...new Set(report.modules.map((module) => module.parserBackend))];
    console.log(JSON.stringify({
      webcontainer: Boolean(process.versions.webcontainer),
      backends,
    }));
    if (!process.versions.webcontainer) throw new Error("Not running in a WebContainer");
    if (!backends.includes("wasm")) throw new Error(
      "Expected the WASM parser backend, got: " + backends.join(", "),
    );
  `;

  const webcontainer = await WebContainer.boot();
  await webcontainer.mount({
    "package.json": { file: { contents: JSON.stringify(packageJson, null, 2) } },
    "local-core": coreTree,
    src: {
      directory: {
        "index.ts": { file: { contents: "export const webcontainerAnswer: number = 42;\n" } },
      },
    },
    "check.mjs": { file: { contents: checkScript } },
  });

  const install = await webcontainer.spawn("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ]);
  const installOutput = await readProcessOutput(install);
  const installExit = await install.exit;
  if (installExit !== 0) throw new Error(`npm install failed (${installExit}): ${installOutput}`);

  const check = await webcontainer.spawn("node", ["check.mjs"]);
  const checkOutput = await readProcessOutput(check);
  const checkExit = await check.exit;
  if (checkExit !== 0) throw new Error(`WebContainer check failed (${checkExit}): ${checkOutput}`);

  result({ ok: true, output: checkOutput });
} catch (error) {
  result({ ok: false, error: error instanceof Error ? error.stack : String(error) });
}
