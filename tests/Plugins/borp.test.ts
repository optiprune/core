import { describe, expect, it } from "vitest";
import { BorpPlugin } from "../../src/plugins/borp-plugin.js";

type Captured = {
  configFiles: string[];
  usedFiles: Array<[string, string | undefined]>;
  usedPackages: string[];
  entryPatterns: string[];
  findings: any[];
};

function createAdapter(
  options: {
    packageJson?: any;
    files?: Record<string, string>;
    configFiles?: string[];
    globFiles?: Record<string, string[]>;
  } = {},
) {
  const captured: Captured = {
    configFiles: [],
    usedFiles: [],
    usedPackages: [],
    entryPatterns: [],
    findings: [],
  };
  const files = { ...options.files };
  const configFiles = new Set(options.configFiles ?? []);
  const adapter = {
    readJson: async (file: string) => (file === "package.json" ? (options.packageJson ?? {}) : null),
    readFile: async (file: string) => files[file] ?? null,
    folderExists: async (file: string) => configFiles.has(file) || file in files,
    findFiles: async (basenames: string[]) => [
      ...new Set([...configFiles, ...Object.keys(files)]),
    ].filter((file) => basenames.some((basename) => file.endsWith(`/${basename}`) || file === basename)),
    findFilesByGlob: async (patterns: string[]) =>
      patterns.flatMap((pattern) => options.globFiles?.[pattern] ?? []),
    markConfigFileAsUsed: (file: string) => captured.configFiles.push(file),
    markAsUsed: (file: string, symbol?: string) => captured.usedFiles.push([file, symbol]),
    markPackageAsUsed: (packageName: string) => captured.usedPackages.push(packageName),
    addEntryPatterns: (patterns: string[]) => captured.entryPatterns.push(...patterns),
    emitFinding: (finding: any) => captured.findings.push(finding),
  } as any;
  return { adapter, captured };
}

describe("BorpPlugin", () => {
  it("detects the documented hidden YAML config names, including nested workspace configs", async () => {
    const { adapter } = createAdapter({ configFiles: ["packages/api/.borp.yml"] });

    await expect(BorpPlugin.detect!(adapter)).resolves.toBe(true);
  });

  it("does not mistake the unsupported borp.config.ts convention for Borp evidence", async () => {
    const { adapter } = createAdapter({ configFiles: ["borp.config.ts"] });

    await expect(BorpPlugin.detect!(adapter)).resolves.toBe(false);
  });

  it("protects YAML config without making it an entry point and registers its configured test files", async () => {
    const configFile = "packages/api/.borp.yaml";
    const { adapter, captured } = createAdapter({
      packageJson: { devDependencies: { borp: "1.0.0" } },
      configFiles: [configFile],
      files: {
        [configFile]: [
          "files:",
          "  - test/**/*.test.ts",
          "  - '!test/**/node_modules/**/*.test.ts'",
          "reporters:",
          "  - spec",
          "  - '@acme/borp-reporter'",
          "  - ./test/reporter.mjs",
        ].join("\n"),
      },
      globFiles: {
        "packages/api/test/**/*.test.ts": [
          "packages/api/test/math.test.ts",
          "packages/api/test/node_modules/ignored.test.ts",
        ],
        "packages/api/test/**/node_modules/**/*.test.ts": [
          "packages/api/test/node_modules/ignored.test.ts",
        ],
      },
    });

    await BorpPlugin.lifecycle.onProjectInit!(adapter);

    expect(captured.configFiles).toEqual([configFile]);
    expect(captured.usedFiles).not.toContainEqual([configFile, undefined]);
    expect(captured.entryPatterns).toEqual(
      expect.arrayContaining(["packages/api/test/math.test.ts", "packages/api/test/reporter.mjs"]),
    );
    expect(captured.entryPatterns).not.toContain("packages/api/test/node_modules/ignored.test.ts");
    expect(captured.usedPackages).toEqual(expect.arrayContaining(["borp", "@acme/borp-reporter"]));
    expect(captured.usedPackages).not.toContain("spec");
    expect(captured.findings).toEqual([]);
  });

  it("uses the exact default Borp test-file family as entries when its command has no file selection", async () => {
    const { adapter, captured } = createAdapter({
      packageJson: { devDependencies: { borp: "1.0.0" }, scripts: { test: "pnpm exec borp --coverage" } },
    });

    await BorpPlugin.lifecycle.onProjectInit!(adapter);

    expect(captured.usedFiles).toContainEqual(["package.json", "scripts:test"]);
    expect(captured.entryPatterns).toEqual(
      expect.arrayContaining(["**/*.test.ts", "**/*.test.mts", "**/*.test.cts"]),
    );
    expect(captured.entryPatterns).not.toContain("**/*.spec.ts");
    expect(captured.usedPackages).toEqual(["borp"]);
  });

  it("supports BORP_CONF_FILE and retains only the configured test entry and reporter package", async () => {
    const configFile = "tools/borp-ci.yaml";
    const { adapter, captured } = createAdapter({
      packageJson: {
        devDependencies: { borp: "1.0.0", "@company/borp-reporter": "1.0.0" },
        scripts: { test: "BORP_CONF_FILE=tools/borp-ci.yaml npx --yes borp" },
      },
      files: {
        [configFile]: [
          "files:",
          "  - integration/**/*.test.mts",
          "reporters:",
          "  - '@company/borp-reporter:reports/borp.xml'",
        ].join("\n"),
      },
    });

    await BorpPlugin.lifecycle.onProjectInit!(adapter);

    expect(captured.configFiles).toEqual([configFile]);
    expect(captured.entryPatterns).toContain("integration/**/*.test.mts");
    expect(captured.entryPatterns).not.toContain("tools/integration/**/*.test.mts");
    expect(captured.usedFiles).toContainEqual(["package.json", "scripts:test"]);
    expect(captured.usedPackages).toEqual(expect.arrayContaining(["borp", "@company/borp-reporter"]));
    expect(captured.findings).toEqual([]);
  });

  it("reports runtime configuration without an installed Borp package instead of creating a false use mark", async () => {
    const { adapter, captured } = createAdapter({
      packageJson: { scripts: { test: "borp test/unit.test.ts" } },
    });

    await BorpPlugin.lifecycle.onProjectInit!(adapter);

    expect(captured.usedFiles).toContainEqual(["package.json", "scripts:test"]);
    expect(captured.entryPatterns).toContain("test/unit.test.ts");
    expect(captured.usedPackages).toEqual([]);
    expect(captured.findings).toHaveLength(1);
    expect(captured.findings[0]).toMatchObject({ rule: "missing-dependency", severity: "error" });
  });

  it("does not treat an incidental command-string mention as a Borp CLI invocation", async () => {
    const { adapter } = createAdapter({
      packageJson: { scripts: { announce: "echo borp --coverage" } },
    });

    await expect(BorpPlugin.detect!(adapter)).resolves.toBe(false);
  });

  it("marks the Borp package only for actual module imports or dynamic imports", () => {
    const { adapter, captured } = createAdapter();

    BorpPlugin.lifecycle.onASTNode?.(
      { type: "ImportDeclaration", source: { value: "borp" } },
      "test/runner.test.ts",
      adapter,
    );
    BorpPlugin.lifecycle.onASTNode?.(
      {
        type: "CallExpression",
        callee: { type: "Import" },
        arguments: [{ type: "StringLiteral", value: "borp/internal" }],
      },
      "test/runner.test.ts",
      adapter,
    );
    BorpPlugin.lifecycle.onASTNode?.(
      { type: "ImportDeclaration", source: { value: "borpish" } },
      "test/runner.test.ts",
      adapter,
    );

    expect(captured.usedPackages).toEqual(["borp", "borp"]);
    expect(captured.usedFiles).toEqual([]);
  });
});
