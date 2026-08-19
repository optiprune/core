import { promises as fs } from "node:fs";
import { describe, expect, it, afterEach } from "vitest";
import path from "pathe";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(__dirname, "fixtures", "layer4-patterns");

afterEach(async () => {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe("Layer 4 JavaScript runtime pattern modeling", () => {
  it("resolves template imports and keeps bundler-runtime constructs executable", async () => {
    await fs.mkdir(path.join(fixtureRoot, "src", "locales"), { recursive: true });
    await fs.writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({ name: "layer4-patterns", private: true }, null, 2));
    await fs.writeFile(path.join(fixtureRoot, "src", "main.ts"), `
      const lang = "de";
      const prefix = "prefix-" + "fixed";
      const SECONDS = 60 * 60 * 24;
      const fallback = process.env.DOES_NOT_EXIST || "fallback";
      const alsoFallback = undefined || "fallback";
      let mutable = "";
      mutable ||= "fallback";
      let nullish;
      nullish ??= "fallback";
      const nested = { value: { answer: 42 } }?.value?.answer ?? "fallback";
      function a() { return 1; }
      function b() { return -1; }
      if (a() === b()) console.log("unreachable");
      /* @__PURE__ */ (() => prefix + SECONDS + fallback + alsoFallback + mutable + nullish + nested)();
      const modules = import.meta.glob("./locales/*.json");
      const context = require.context("./locales", false, /\\.json$/);
      new Worker(new URL("./worker.js", import.meta.url));
      WebAssembly.instantiate(new Uint8Array());
      const tag = document.createElement("script");
      tag.src = new URL("./worker.js", import.meta.url).href;
      document.head.appendChild(tag);
      await import(\`./locales/\${lang}.json\`);
    `);
    await fs.writeFile(path.join(fixtureRoot, "src", "locales", "de.json"), "export default { hello: 'Hallo' };\n");
    await fs.writeFile(path.join(fixtureRoot, "src", "locales", "en.json"), "export default { hello: 'Hello' };\n");
    await fs.writeFile(path.join(fixtureRoot, "src", "worker.js"), "self.onmessage = () => {};\n");

    const report = await analyze({
      rootDir: fixtureRoot,
      entry: ["src/main.ts"],
      extensions: [".ts", ".js", ".json"],
      includeConventionalEntries: false,
      reportUnusedExports: true,
      layers: { skip3: false, skip4: false },
    });

    const normalized = report.findings.map((finding) => `${finding.rule}:${finding.file.replaceAll("\\\\", "/")}`);
    expect(normalized.some((value) => value.includes("unreachable-file") && value.includes("locales/de.json"))).toBe(false);
    expect(normalized.some((value) => value.includes("unreachable-file") && value.includes("locales/en.json"))).toBe(false);
    expect(normalized.some((value) => value.includes("unreachable-file") && value.includes("worker.js"))).toBe(false);
    expect(report.findings.some((finding) => finding.rule === "unknown-dynamic-import")).toBe(false);
  });

  it("does not crash on direct dynamic imports with string concatenation and eval", async () => {
    await fs.mkdir(path.join(fixtureRoot, "src", "locales"), { recursive: true });
    await fs.writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({ name: "layer4-eval", private: true }, null, 2));
    await fs.writeFile(path.join(fixtureRoot, "src", "main.ts"), `
      const suffix = "de";
      const expression = "./locales/" + suffix + ".json";
      const evaluate = new Function("x", "return x + 1");
      eval("void 0");
      await import(expression);
    `);
    await fs.writeFile(path.join(fixtureRoot, "src", "locales", "de.json"), "export default {};\n");

    const report = await analyze({
      rootDir: fixtureRoot,
      entry: ["src/main.ts"],
      extensions: [".ts", ".json"],
      includeConventionalEntries: false,
      layers: { skip3: false, skip4: false },
    });
    expect(report.findings.some((finding) => finding.rule === "unknown-dynamic-import")).toBe(false);
    expect(report.findings.some((finding) => finding.rule === "unreachable-file" && finding.file.endsWith("locales/de.json"))).toBe(false);
  });
});
