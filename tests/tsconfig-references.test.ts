import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "pathe";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(__dirname, "fixtures", "tsconfig-references-aliases");

afterEach(async () => {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe("tsconfig references and wildcard aliases", () => {
  it("resolves @/* through a referenced app tsconfig before classifying imports as external", async () => {
    await fs.mkdir(path.join(fixtureRoot, "src", "components"), { recursive: true });
    await fs.writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({ name: "tsconfig-references-aliases", private: true }, null, 2));
    await fs.writeFile(path.join(fixtureRoot, "tsconfig.json"), JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.app.json" }]
    }, null, 2));
    await fs.writeFile(path.join(fixtureRoot, "tsconfig.app.json"), JSON.stringify({
      compilerOptions: {
        moduleResolution: "Bundler",
        baseUrl: ".",
        paths: { "@/*": ["src/*"] }
      },
      include: ["src"]
    }, null, 2));
    await fs.writeFile(path.join(fixtureRoot, "src", "main.ts"), "import { greeting } from '@/components/greeting';\nconsole.log(greeting);\n");
    await fs.writeFile(path.join(fixtureRoot, "src", "components", "greeting.ts"), "export const greeting = 'hello';\n");

    const report = await analyze({
      rootDir: fixtureRoot,
      entry: ["src/main.ts"],
      extensions: [".ts"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
    });

    expect(report.findings.some((finding) => finding.rule === "unreachable-file" && finding.file.endsWith("src/components/greeting.ts"))).toBe(false);
    expect(report.findings.some((finding) => finding.rule === "missing-dependency" && finding.evidence.package === "@/components/greeting")).toBe(false);
    const mainModule = report.modules.find((module) => module.path === "src/main.ts");
    expect(mainModule?.edges).toContainEqual(expect.objectContaining({
      specifier: "@/components/greeting",
      target: "src/components/greeting.ts",
      resolution: "resolved",
    }));
  });
});
