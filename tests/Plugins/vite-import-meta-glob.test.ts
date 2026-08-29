import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "pathe";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(__dirname, "fixtures", "vite-import-meta-glob");

afterEach(async () => {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe("Vite import.meta.glob reachability", () => {
  it("marks only source files matched by a relative Vite glob as reachable", async () => {
    await fs.mkdir(path.join(fixtureRoot, "src", "features", "alpha"), { recursive: true });
    await fs.mkdir(path.join(fixtureRoot, "src", "features", "beta"), { recursive: true });
    await fs.writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify(
        {
          name: "vite-import-meta-glob",
          private: true,
          devDependencies: { vite: "^6.0.0" },
        },
        null,
        2,
      ),
    );
    await fs.writeFile(
      path.join(fixtureRoot, "src", "main.ts"),
      "const modules = import.meta.glob('./features/*/register.ts', { eager: true });\nconsole.log(modules);\n",
    );
    await fs.writeFile(
      path.join(fixtureRoot, "src", "features", "alpha", "register.ts"),
      "export const register = () => undefined;\n",
    );
    await fs.writeFile(
      path.join(fixtureRoot, "src", "features", "beta", "register.ts"),
      "export const register = () => undefined;\n",
    );
    await fs.writeFile(
      path.join(fixtureRoot, "src", "features", "beta", "not-registered.ts"),
      "export const notRegistered = true;\n",
    );

    const report = await analyze({
      rootDir: fixtureRoot,
      entry: ["src/main.ts"],
      extensions: [".ts"],
      includeConventionalEntries: false,
    });

    const unreachable = new Set(
      report.findings
        .filter((finding) => finding.rule === "unreachable-file")
        .map((finding) => finding.file.replaceAll("\\", "/")),
    );
    expect(
      unreachable.has(
        path.join(fixtureRoot, "src", "features", "alpha", "register.ts").replaceAll("\\", "/"),
      ),
    ).toBe(false);
    expect(
      unreachable.has(
        path.join(fixtureRoot, "src", "features", "beta", "register.ts").replaceAll("\\", "/"),
      ),
    ).toBe(false);
    expect(
      unreachable.has(
        path
          .join(fixtureRoot, "src", "features", "beta", "not-registered.ts")
          .replaceAll("\\", "/"),
      ),
    ).toBe(true);
    expect(
      report.findings.some(
        (finding) => finding.rule === "unused-export" && finding.evidence.exportName === "register",
      ),
    ).toBe(false);
  });
});
