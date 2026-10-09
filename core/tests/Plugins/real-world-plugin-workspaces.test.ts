import { describe, expect, it } from "vitest";
import path from "pathe";
import { fileURLToPath } from "node:url";
import { analyze } from "../../src/index.js";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/plugins");

type Report = Awaited<ReturnType<typeof analyze>>;

async function analyzeFixture(name: string, options: Partial<Parameters<typeof analyze>[0]> = {}) {
  return analyze({
    rootDir: path.join(fixtures, name),
    entry: [],
    includeConventionalEntries: true,
    reportUnusedExports: true,
    reportUnusedExportsInUnreachableFiles: true,
    failOn: "none",
    layers: { skip3: true, skip4: true },
    ...options,
  });
}

function unusedPackageFindings(report: Report, packageName: string) {
  return report.findings.filter(
    (finding) =>
      (finding.rule === "unused-dependency" || finding.rule === "unused-dev-dependency") &&
      finding.evidence?.package === packageName,
  );
}

function unreachableFiles(report: Report) {
  return report.findings
    .filter((finding) => finding.rule === "unreachable-file")
    .map((finding) => finding.file.replace(/\\/g, "/"));
}

function expectDependenciesToBeLive(report: Report, packageNames: string[]) {
  for (const packageName of packageNames) {
    expect(unusedPackageFindings(report, packageName), packageName).toHaveLength(0);
  }
}

function expectFilesToBeReachable(report: Report, fileSuffixes: string[]) {
  const unreachable = unreachableFiles(report);
  for (const fileSuffix of fileSuffixes) {
    expect(unreachable, fileSuffix).not.toEqual(
      expect.arrayContaining([expect.stringContaining(fileSuffix)]),
    );
  }
}

describe("real-world plugin workspaces", () => {
  it("keeps an Astro Starlight content site, DB setup, API routes, and integration packages live", async () => {
    const report = await analyzeFixture("astro-starlight-content", {
      extensions: [".ts", ".mjs", ".astro", ".css"],
    });

    expectDependenciesToBeLive(report, [
      "astro",
      "@astrojs/starlight",
      "@astrojs/markdoc",
      "@astrojs/db",
      "@fontsource/inter",
    ]);
    expectFilesToBeReachable(report, [
      "astro.config.mjs",
      "markdoc.config.ts",
      "db/config.ts",
      "db/seed.ts",
      "src/pages/api/health.ts",
      "src/content/config.ts",
      "src/actions/contact.ts",
      "src/styles/docs.css",
    ]);
  });

  it("honors VS Code JSONC task, launch, and settings contracts for a TypeScript service", async () => {
    const report = await analyzeFixture("vscode-typescript-service", {
      extensions: [".ts", ".cjs"],
    });

    expectDependenciesToBeLive(report, ["prettier", "tsx", "typescript"]);
    expectFilesToBeReachable(report, ["src/server.ts", "prettier.config.cjs"]);
  });

  it("keeps Express controllers, routers, middleware, and CommonJS-mounted routes live", async () => {
    const report = await analyzeFixture("express-api-service", {
      entry: ["src/server.ts"],
      extensions: [".ts"],
    });

    expectDependenciesToBeLive(report, ["express"]);
    expectFilesToBeReachable(report, [
      "src/routes/orders.ts",
      "src/routes/legacy.ts",
      "src/controllers/health.ts",
      "src/middleware/authenticate.ts",
    ]);
  });

  it("retains a Convex backend schema, generated contracts, and query/mutation handlers", async () => {
    const report = await analyzeFixture("convex-backend", { extensions: [".ts"] });

    expectDependenciesToBeLive(report, ["convex"]);
    expectFilesToBeReachable(report, [
      "convex/schema.ts",
      "convex/tasks.ts",
      "convex/_generated/server.ts",
    ]);
    const deadConvexExports = report.findings.filter(
      (finding) => finding.rule === "unused-export" && finding.file.includes("convex/tasks.ts"),
    );
    expect(deadConvexExports).toHaveLength(0);
  });

  it("recognizes Commitlint presets, local extensions, Husky hooks, and CI workflow usage", async () => {
    const report = await analyzeFixture("commitlint-husky-workflow", {
      extensions: [".cjs"],
    });

    expectDependenciesToBeLive(report, [
      "@commitlint/cli",
      "@commitlint/config-conventional",
      "commitlint-plugin-jira",
    ]);
    expectFilesToBeReachable(report, ["commitlint.config.cjs", "config/commitlint-local.cjs"]);
  });

  it("retains Gatsby configuration plugins, lifecycle APIs, pages, templates, and GraphQL imports", async () => {
    const report = await analyzeFixture("gatsby-content-site", {
      extensions: [".ts", ".tsx", ".cjs"],
    });

    expectDependenciesToBeLive(report, ["gatsby", "gatsby-plugin-image", "gatsby-plugin-manifest"]);
    expectFilesToBeReachable(report, [
      "gatsby-config.cjs",
      "gatsby-node.ts",
      "src/pages/index.tsx",
      "src/templates/post.tsx",
    ]);
  });
});
