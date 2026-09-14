import { describe, expect, it } from "vitest";
import { StorybookPlugin } from "../../src/plugins/storybook-plugin.js";
import { BiomePlugin } from "../../src/plugins/biome-plugin.js";

type Captured = {
  usedFiles: Array<[string, string | undefined]>;
  usedPackages: string[];
  findings: any[];
  projectPatterns: string[];
};

function createAdapter(
  options: {
    packageJson?: any;
    configFiles?: string[];
    files?: Record<string, string>;
    rootStorybookDirectory?: boolean;
  } = {},
) {
  const captured: Captured = {
    usedFiles: [],
    usedPackages: [],
    findings: [],
    projectPatterns: [],
  };
  const adapter = {
    readJson: async (file: string) =>
      file === "package.json" ? (options.packageJson ?? {}) : null,
    readFile: async (file: string) => options.files?.[file] ?? null,
    folderExists: async (file: string) =>
      file === ".storybook" ? !!options.rootStorybookDirectory : !!options.files?.[file],
    findFiles: async (_basenames: string[]) => options.configFiles ?? [],
    markAsUsed: (file: string, symbol?: string) => captured.usedFiles.push([file, symbol]),
    markPackageAsUsed: (packageName: string) => captured.usedPackages.push(packageName),
    emitFinding: (finding: any) => captured.findings.push(finding),
    addProjectPatterns: (patterns: string[]) => captured.projectPatterns.push(...patterns),
  } as any;
  return { adapter, captured };
}

describe("StorybookPlugin configuration evidence", () => {
  it("detects a nested Storybook config even before dependencies are declared", async () => {
    const { adapter } = createAdapter({
      configFiles: ["packages/ui/.storybook/main.ts"],
    });
    await expect(StorybookPlugin.detect!(adapter)).resolves.toBe(true);
  });

  it("retains declared framework and addon packages used only by a nested Storybook config", async () => {
    const { adapter, captured } = createAdapter({
      packageJson: {
        devDependencies: {
          storybook: "9.0.0",
          "@storybook/react-vite": "9.0.0",
          "@storybook/addon-essentials": "9.0.0",
        },
      },
      configFiles: ["packages/ui/.storybook/main.ts"],
    });

    await StorybookPlugin.lifecycle.onProjectInit!(adapter);

    expect(captured.usedFiles).toContainEqual(["packages/ui/.storybook/main.ts", undefined]);
    expect(captured.usedPackages).toEqual(
      expect.arrayContaining(["storybook", "@storybook/react-vite", "@storybook/addon-essentials"]),
    );
    expect(captured.findings).toEqual([]);
  });

  it("reports a missing dependency rather than silently marking a nonexistent Storybook package", async () => {
    const { adapter, captured } = createAdapter({
      configFiles: ["apps/docs/.storybook/main.ts"],
    });

    await StorybookPlugin.lifecycle.onProjectInit!(adapter);

    expect(captured.usedPackages).toEqual([]);
    expect(captured.findings).toHaveLength(1);
    expect(captured.findings[0]).toMatchObject({ rule: "missing-dependency", severity: "error" });
  });

  it("retains framework and addon descriptors declared inside main.ts", () => {
    const { adapter, captured } = createAdapter();
    const configFile = "/repo/packages/ui/.storybook/main.ts";

    StorybookPlugin.lifecycle.onASTNode?.(
      {
        type: "Property",
        computed: false,
        key: { type: "Identifier", name: "framework" },
        value: {
          type: "ObjectExpression",
          properties: [
            {
              type: "Property",
              computed: false,
              key: { type: "Identifier", name: "name" },
              value: { type: "Literal", value: "@storybook/react-vite" },
            },
          ],
        },
      },
      configFile,
      adapter,
    );

    StorybookPlugin.lifecycle.onASTNode?.(
      {
        type: "Property",
        computed: false,
        key: { type: "Identifier", name: "addons" },
        value: {
          type: "ArrayExpression",
          elements: [{ type: "Literal", value: "@storybook/addon-a11y" }],
        },
      },
      configFile,
      adapter,
    );

    expect(captured.usedPackages).toEqual(
      expect.arrayContaining(["@storybook/react-vite", "@storybook/addon-a11y"]),
    );
  });

  it("protects default, named function, and named class CSF exports", () => {
    const { adapter, captured } = createAdapter();
    const storyFile = "/repo/src/Button.stories.tsx";

    StorybookPlugin.lifecycle.onASTNode?.(
      { type: "ExportDefaultDeclaration", declaration: {} },
      storyFile,
      adapter,
    );
    StorybookPlugin.lifecycle.onASTNode?.(
      {
        type: "ExportNamedDeclaration",
        declaration: {
          type: "FunctionDeclaration",
          id: { type: "Identifier", name: "Primary" },
          params: [],
          body: {},
        },
      },
      storyFile,
      adapter,
    );
    StorybookPlugin.lifecycle.onASTNode?.(
      {
        type: "ExportNamedDeclaration",
        declaration: {
          type: "ClassDeclaration",
          id: { type: "Identifier", name: "Experimental" },
        },
      },
      storyFile,
      adapter,
    );

    expect(captured.usedFiles).toEqual(
      expect.arrayContaining([
        [storyFile, "default"],
        [storyFile, "Primary"],
        [storyFile, "Experimental"],
      ]),
    );
  });
});

describe("BiomePlugin configuration evidence", () => {
  it("detects documented hidden and nested Biome configuration names", async () => {
    const { adapter } = createAdapter({ configFiles: ["apps/admin/.biome.jsonc"] });
    await expect(BiomePlugin.detect!(adapter)).resolves.toBe(true);
  });

  it("retains a declared Biome package when a nested config is its only usage evidence", async () => {
    const configFile = "packages/ui/biome.jsonc";
    const { adapter, captured } = createAdapter({
      packageJson: { devDependencies: { "@biomejs/biome": "2.0.0" } },
      configFiles: [configFile],
      files: {
        [configFile]: JSON.stringify({
          extends: ["./base.json", "@company/biome-config", "//"],
          plugins: ["./rules.grit", { path: "./typed.grit" }],
          files: { includes: ["src/**/*.ts", "!src/generated/**"] },
        }),
      },
    });

    await BiomePlugin.lifecycle.onProjectInit!(adapter);

    expect(captured.usedFiles).toEqual(
      expect.arrayContaining([
        [configFile, undefined],
        ["packages/ui/base.json", undefined],
        ["packages/ui/rules.grit", undefined],
        ["packages/ui/typed.grit", undefined],
      ]),
    );
    expect(captured.usedPackages).toContain("@biomejs/biome");
    expect(captured.projectPatterns).toEqual(
      expect.arrayContaining(["packages/ui/src/**/*.ts", "packages/ui/!src/generated/**"]),
    );
    expect(captured.findings).toEqual([]);
  });

  it("reports a missing package for a Biome config and does not manufacture usage", async () => {
    const { adapter, captured } = createAdapter({
      configFiles: ["biome.json"],
      files: { "biome.json": "{}" },
    });

    await BiomePlugin.lifecycle.onProjectInit!(adapter);

    expect(captured.usedPackages).toEqual([]);
    expect(captured.findings).toHaveLength(1);
    expect(captured.findings[0]).toMatchObject({
      rule: "missing-dependency",
      message: expect.stringContaining("@biomejs/biome"),
    });
  });
});

import { OxlintPlugin } from "../../src/plugins/oxlint-plugin.js";

describe("OxlintPlugin configuration evidence", () => {
  it("detects documented nested OXLint configuration without a declared package", async () => {
    const { adapter } = createAdapter({ configFiles: ["packages/ui/oxlint.config.mts"] });
    await expect(OxlintPlugin.detect!(adapter)).resolves.toBe(true);
  });

  it("retains a declared OXLint package when nested configuration is the only evidence", async () => {
    const configFile = "packages/ui/.oxlintrc.jsonc";
    const { adapter, captured } = createAdapter({
      packageJson: { devDependencies: { oxlint: "1.0.0" } },
      configFiles: [configFile],
      files: {
        [configFile]: JSON.stringify({ extends: ["./base.json", "@company/oxlint-config"] }),
      },
    });

    await OxlintPlugin.lifecycle.onProjectInit!(adapter);

    expect(captured.usedPackages).toEqual(["oxlint"]);
    expect(captured.usedFiles).toEqual(
      expect.arrayContaining([
        [configFile, undefined],
        ["packages/ui/base.json", undefined],
      ]),
    );
    expect(captured.findings).toEqual([]);
  });

  it("retains packages referenced by OXLint jsPlugins and marks local plugin files", async () => {
    const configFile = ".oxlintrc.json";
    const localPlugin = "scripts/oxlint-repo-guidelines.js";
    const { adapter, captured } = createAdapter({
      packageJson: { devDependencies: { oxlint: "1.0.0", "eslint-plugin-security": "1.0.0" } },
      configFiles: [configFile, localPlugin],
      files: {
        [configFile]: JSON.stringify({
          jsPlugins: [
            "eslint-plugin-security",
            "./scripts/oxlint-test-guidelines.js",
            "./scripts/oxlint-repo-guidelines.js",
          ],
        }),
      },
    });

    await OxlintPlugin.lifecycle.onProjectInit!(adapter);

    expect(captured.usedPackages).toEqual(
      expect.arrayContaining(["oxlint", "eslint-plugin-security"]),
    );
    expect(captured.usedFiles).toEqual(
      expect.arrayContaining([
        ["scripts/oxlint-test-guidelines.js", undefined],
        [localPlugin, undefined],
      ]),
    );
    expect(captured.findings).toEqual([]);
  });

  it("reports an undeclared OXLint dependency when config or command exists", async () => {
    const { adapter, captured } = createAdapter({
      packageJson: {
        scripts: {
          lint: "oxlint -c tooling/lint.json --tsconfig tsconfig.lint.json --ignore-path .oxlintignore src",
        },
      },
      configFiles: [".oxlintrc.json"],
      files: { ".oxlintrc.json": "{}" },
    });

    await OxlintPlugin.lifecycle.onProjectInit!(adapter);

    expect(captured.usedPackages).toEqual([]);
    expect(captured.usedFiles).toEqual(
      expect.arrayContaining([
        ["package.json", "scripts:lint"],
        ["tooling/lint.json", undefined],
        ["tsconfig.lint.json", undefined],
        [".oxlintignore", undefined],
      ]),
    );
    expect(captured.findings).toHaveLength(1);
    expect(captured.findings[0]).toMatchObject({ rule: "missing-dependency", severity: "error" });
  });
});

import { PayloadCMSPlugin } from "../../src/plugins/payload-cms-plugin.js";

describe("PayloadCMSPlugin configuration evidence", () => {
  it("detects a nested Payload config before a dependency is declared", async () => {
    const { adapter } = createAdapter({ configFiles: ["apps/cms/payload.config.ts"] });
    await expect(PayloadCMSPlugin.detect!(adapter)).resolves.toBe(true);
  });

  it("retains only the Payload core package for config-only usage", async () => {
    const configFile = "apps/cms/payload.config.ts";
    const { adapter, captured } = createAdapter({
      packageJson: {
        dependencies: {
          payload: "3.0.0",
          "@payloadcms/plugin-seo": "3.0.0",
        },
      },
      configFiles: [configFile],
    });

    await PayloadCMSPlugin.lifecycle.onProjectInit!(adapter);

    expect(captured.usedFiles).toContainEqual([configFile, undefined]);
    expect(captured.usedPackages).toEqual(["payload"]);
    expect(captured.findings).toEqual([]);
  });

  it("marks an optional Payload package only when it is actually imported", () => {
    const { adapter, captured } = createAdapter();
    PayloadCMSPlugin.lifecycle.onASTNode?.(
      {
        type: "ImportDeclaration",
        source: { type: "Literal", value: "@payloadcms/plugin-seo" },
        specifiers: [],
      },
      "/repo/apps/cms/payload.config.ts",
      adapter,
    );

    expect(captured.usedPackages).toEqual(["@payloadcms/plugin-seo"]);
  });

  it("reports a missing core package for a real Payload config", async () => {
    const { adapter, captured } = createAdapter({ configFiles: ["payload.config.ts"] });
    await PayloadCMSPlugin.lifecycle.onProjectInit!(adapter);

    expect(captured.usedPackages).toEqual([]);
    expect(captured.findings).toHaveLength(1);
    expect(captured.findings[0]).toMatchObject({
      rule: "missing-dependency",
      message: expect.stringContaining("'payload'"),
    });
  });
});

import { LintHtmlPlugin } from "../../src/plugins/lint-html-plugin.js";

describe("LintHtmlPlugin configuration evidence", () => {
  it("detects a nested LintHTML configuration without a dependency declaration", async () => {
    const { adapter } = createAdapter({ configFiles: ["packages/docs/.linthtmlrc"] });
    await expect(LintHtmlPlugin.detect!(adapter)).resolves.toBe(true);
  });

  it("retains the locally declared LintHTML package for file or package.json configuration", async () => {
    const { adapter, captured } = createAdapter({
      packageJson: {
        devDependencies: { "@linthtml/linthtml": "0.9.0" },
        linthtml: { rules: { "attr-no-dup": "error" } },
      },
      configFiles: ["packages/docs/.linthtmlrc"],
    });

    await LintHtmlPlugin.lifecycle.onProjectInit!(adapter);

    expect(captured.usedFiles).toEqual(
      expect.arrayContaining([
        ["packages/docs/.linthtmlrc", undefined],
        ["package.json", "linthtml"],
      ]),
    );
    expect(captured.usedPackages).toEqual(["@linthtml/linthtml"]);
    expect(captured.findings).toEqual([]);
  });

  it("reports missing LintHTML dependency without marking an undeclared package", async () => {
    const { adapter, captured } = createAdapter({
      packageJson: { scripts: { lint: "linthtml 'src/**/*.html'" } },
      configFiles: [".linthtmlrc"],
    });

    await LintHtmlPlugin.lifecycle.onProjectInit!(adapter);

    expect(captured.usedPackages).toEqual([]);
    expect(captured.findings).toHaveLength(1);
    expect(captured.findings[0]).toMatchObject({ rule: "missing-dependency", severity: "error" });
  });
});

import { ChangelogenPlugin } from "../../src/plugins/changelogen-plugin.js";
import { ChangelogithubPlugin } from "../../src/plugins/changelogithub-plugin.js";

describe("ChangelogenPlugin configuration evidence", () => {
  it("recognizes the official changelog.config.json and package.json#changelog inputs", async () => {
    const { adapter } = createAdapter({
      packageJson: { changelog: { output: "CHANGELOG.md" } },
      configFiles: ["packages/core/changelog.config.json"],
    });
    await expect(ChangelogenPlugin.detect!(adapter)).resolves.toBe(true);
  });

  it("retains the declared package for official config and reports an undeclared one", async () => {
    const used = createAdapter({
      packageJson: { devDependencies: { changelogen: "4.0.0" } },
      configFiles: ["changelog.config.ts"],
    });
    await ChangelogenPlugin.lifecycle.onProjectInit!(used.adapter);
    expect(used.captured.usedPackages).toEqual(["changelogen"]);

    const missing = createAdapter({ configFiles: [".changelogrc"] });
    await ChangelogenPlugin.lifecycle.onProjectInit!(missing.adapter);
    expect(missing.captured.usedPackages).toEqual([]);
    expect(missing.captured.findings).toHaveLength(1);
    expect(missing.captured.findings[0]).toMatchObject({ rule: "missing-dependency" });
  });
});

describe("ChangelogithubPlugin configuration evidence", () => {
  it("recognizes the official JSON config and package.json#changelogithub input", async () => {
    const { adapter } = createAdapter({
      packageJson: { changelogithub: { token: "${GITHUB_TOKEN}" } },
      configFiles: ["apps/release/changelogithub.config.json"],
    });
    await expect(ChangelogithubPlugin.detect!(adapter)).resolves.toBe(true);
  });

  it("retains a declared package and emits a missing-dependency finding otherwise", async () => {
    const used = createAdapter({
      packageJson: { devDependencies: { changelogithub: "15.0.0" } },
      configFiles: ["changelogithub.config.mts"],
    });
    await ChangelogithubPlugin.lifecycle.onProjectInit!(used.adapter);
    expect(used.captured.usedPackages).toEqual(["changelogithub"]);

    const missing = createAdapter({ configFiles: [".changelogithubrc"] });
    await ChangelogithubPlugin.lifecycle.onProjectInit!(missing.adapter);
    expect(missing.captured.usedPackages).toEqual([]);
    expect(missing.captured.findings).toHaveLength(1);
    expect(missing.captured.findings[0]).toMatchObject({ rule: "missing-dependency" });
  });
});

import { ChangesetsPlugin } from "../../src/plugins/changesets-plugin.js";

describe("ChangesetsPlugin configuration evidence", () => {
  it("detects the .changeset directory without a source import", async () => {
    const { adapter } = createAdapter({ rootStorybookDirectory: false });
    adapter.folderExists = async (file: string) => file === ".changeset";
    await expect(ChangesetsPlugin.detect!(adapter)).resolves.toBe(true);
  });

  it("retains a declared CLI and custom changelog package, but never treats ignored workspace names as dependencies", async () => {
    const { adapter, captured } = createAdapter({
      packageJson: {
        devDependencies: { "@changesets/cli": "2.0.0", "@changesets/changelog-github": "0.5.0" },
      },
      files: {
        ".changeset/config.json": JSON.stringify({
          changelog: ["@changesets/changelog-github", { repo: "acme/core" }],
          ignore: ["@acme/internal-package"],
        }),
      },
    });
    adapter.folderExists = async (file: string) =>
      file === ".changeset" || file === ".changeset/config.json";
    adapter.readJson = async (file: string) => {
      if (file === "package.json")
        return {
          devDependencies: { "@changesets/cli": "2.0.0", "@changesets/changelog-github": "0.5.0" },
        };
      if (file === ".changeset/config.json")
        return {
          changelog: ["@changesets/changelog-github", { repo: "acme/core" }],
          ignore: ["@acme/internal-package"],
        };
      return null;
    };

    await ChangesetsPlugin.lifecycle.onProjectInit!(adapter);

    expect(captured.usedPackages).toEqual(
      expect.arrayContaining(["@changesets/cli", "@changesets/changelog-github"]),
    );
    expect(captured.usedPackages).not.toContain("@acme/internal-package");
    expect(captured.findings).toEqual([]);
  });

  it("reports an undeclared CLI instead of silently claiming it is used", async () => {
    const { adapter, captured } = createAdapter({
      packageJson: { scripts: { version: "changeset version" } },
      files: { ".changeset/config.json": "{}" },
    });
    adapter.folderExists = async (file: string) =>
      file === ".changeset" || file === ".changeset/config.json";

    await ChangesetsPlugin.lifecycle.onProjectInit!(adapter);

    expect(captured.usedPackages).toEqual([]);
    expect(captured.findings).toHaveLength(1);
    expect(captured.findings[0]).toMatchObject({ rule: "missing-dependency", severity: "error" });
  });
});

import { CypressPlugin } from "../../src/plugins/cypress-plugin.js";

describe("CypressPlugin configuration evidence", () => {
  it("detects supported nested modern config files without a declared package", async () => {
    const { adapter } = createAdapter({ configFiles: ["apps/web/cypress.config.mts"] });
    await expect(CypressPlugin.detect!(adapter)).resolves.toBe(true);
  });

  it("retains a locally declared Cypress package for a nested config and command", async () => {
    const configFile = "apps/web/cypress.config.ts";
    const { adapter, captured } = createAdapter({
      packageJson: { devDependencies: { cypress: "15.0.0" }, scripts: { e2e: "cypress run" } },
      configFiles: [configFile],
    });

    await CypressPlugin.lifecycle.onProjectInit!(adapter);

    expect(captured.usedFiles).toEqual(
      expect.arrayContaining([
        [configFile, undefined],
        ["package.json", "scripts:e2e"],
      ]),
    );
    expect(captured.usedPackages).toEqual(["cypress"]);
    expect(captured.findings).toEqual([]);
  });

  it("reports missing Cypress instead of marking a nonexistent package as used", async () => {
    const { adapter, captured } = createAdapter({
      packageJson: { scripts: { e2e: "pnpm exec cypress run" } },
      configFiles: ["cypress.config.cjs"],
    });

    await CypressPlugin.lifecycle.onProjectInit!(adapter);

    expect(captured.usedPackages).toEqual([]);
    expect(captured.findings).toHaveLength(1);
    expect(captured.findings[0]).toMatchObject({ rule: "missing-dependency", severity: "error" });
  });
});

import { JestPlugin } from "../../src/plugins/jest-plugin.js";

describe("JestPlugin configuration evidence", () => {
  it("detects a nested modern Jest config without a declared package", async () => {
    const { adapter } = createAdapter({ configFiles: ["packages/api/jest.config.mts"] });
    await expect(JestPlugin.detect!(adapter)).resolves.toBe(true);
  });

  it("retains a declared Jest package for config and command evidence", async () => {
    const configFile = "packages/api/jest.config.ts";
    const { adapter, captured } = createAdapter({
      packageJson: { devDependencies: { jest: "30.0.0" }, scripts: { test: "jest --runInBand" } },
      configFiles: [configFile],
    });

    await JestPlugin.lifecycle.onProjectInit!(adapter);

    expect(captured.usedFiles).toEqual(
      expect.arrayContaining([
        [configFile, undefined],
        ["package.json", "scripts:test"],
      ]),
    );
    expect(captured.usedPackages).toEqual(["jest"]);
    expect(captured.findings).toEqual([]);
  });

  it("reports missing Jest rather than creating a package-use mark from config", async () => {
    const { adapter, captured } = createAdapter({
      packageJson: { jest: { testEnvironment: "node" } },
      configFiles: ["jest.config.cts"],
    });

    await JestPlugin.lifecycle.onProjectInit!(adapter);

    expect(captured.usedPackages).toEqual([]);
    expect(captured.findings).toHaveLength(1);
    expect(captured.findings[0]).toMatchObject({ rule: "missing-dependency", severity: "error" });
  });
});
