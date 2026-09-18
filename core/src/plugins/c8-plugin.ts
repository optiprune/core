import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const C8_CONFIG_FILES = [
  ".c8rc",
  ".c8rc.json",
  "c8.config.js",
  "c8.config.cjs",
  "c8.config.mjs",
  "c8.config.ts",
];

const C8_PACKAGE_NAME = "c8";

const BUILT_IN_REPORTERS = new Set([
  "clover",
  "cobertura",
  "html",
  "json",
  "json-summary",
  "lcov",
  "lcovonly",
  "none",
  "teamcity",
  "text",
  "text-lcov",
  "text-summary",
]);

type CoverageLocation = {
  start: { line: number; column: number };
  end: { line: number; column: number };
};

type CoverageEntry = {
  path: string;
  statementMap?: Record<string, CoverageLocation>;
  s?: Record<string, number>;
  fnMap?: Record<string, { name?: string; loc?: CoverageLocation; line?: number }>;
  f?: Record<string, number>;
  branchMap?: Record<string, { line?: number; locations?: CoverageLocation[] }>;
  b?: Record<string, number[]>;
};

function extractReporterPackages(configObj: any, adapter: any): void {
  if (!configObj) return;

  const processReporters = (reporterVal: any) => {
    const list = Array.isArray(reporterVal) ? reporterVal : [reporterVal];
    for (const item of list) {
      if (
        typeof item === "string" &&
        !item.startsWith(".") &&
        !item.startsWith("/") &&
        !BUILT_IN_REPORTERS.has(item)
      ) {
        adapter.markPackageAsUsed(item);
      }
    }
  };

  if (t.isObjectExpression(configObj)) {
    for (const prop of configObj.properties) {
      if (!t.isObjectProperty(prop)) continue;
      const keyName = prop.key?.name || prop.key?.value;
      if (keyName !== "reporter") continue;
      if (t.isStringLiteral(prop.value)) processReporters(prop.value.value);
      else if (t.isArrayExpression(prop.value)) {
        for (const element of prop.value.elements) {
          if (t.isStringLiteral(element)) processReporters(element.value);
        }
      }
    }
  } else if (typeof configObj === "object") {
    processReporters(configObj.reporter);
  }
}

function ignoredLines(source: string): Set<number> {
  const ignored = new Set<number>();
  const lines = source.split(/\r?\n/);
  let range = false;

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = lines[index] ?? "";
    if (line.includes("c8 ignore start")) range = true;
    if (range) ignored.add(lineNumber);
    const next = line.match(/c8 ignore next(?:\s+(\d+))?/);
    if (next) {
      const count = Number(next[1] ?? 1);
      for (let offset = 1; offset <= count; offset += 1) ignored.add(lineNumber + offset);
    }
    if (line.includes("c8 ignore stop")) {
      ignored.add(lineNumber);
      range = false;
    }
  }

  return ignored;
}

function relativeToRoot(file: string, rootDir: string): string {
  return path.relative(rootDir, file).replace(/\\/g, "/");
}

async function ingestCoverage(adapter: any): Promise<void> {
  const report = await adapter.readJson("coverage-final.json");
  if (!report || typeof report !== "object") return;
  const rootDir = adapter.getConfig().rootDir;

  for (const value of Object.values(report) as CoverageEntry[]) {
    if (!value?.path || !value.statementMap || !value.s) continue;
    const file = path.normalize(value.path);
    if (!file.startsWith(path.normalize(rootDir))) continue;
    const source = await adapter.readFile(relativeToRoot(file, rootDir));
    const ignored = source ? ignoredLines(source) : new Set<number>();
    const displayFile = relativeToRoot(file, rootDir);

    for (const [id, count] of Object.entries(value.s)) {
      const location = value.statementMap[id];
      if (!location || count > 0 || ignored.has(location.start.line)) continue;
      adapter.emitFinding({
        rule: "uncovered-runtime-statement",
        severity: "warning",
        confidence: "high",
        file,
        location: {
          start: location.start,
          end: location.end,
        },
        message: `c8 reports an uncovered statement in ${displayFile}`,
        evidence: { source: "c8", kind: "statement", count, coverageFile: "coverage-final.json" },
      });
    }

    for (const [id, count] of Object.entries(value.f ?? {})) {
      const functionRecord = value.fnMap?.[id];
      const location = functionRecord?.loc;
      const line = location?.start.line ?? functionRecord?.line;
      if (count > 0 || !line || ignored.has(line)) continue;
      adapter.emitFinding({
        rule: "uncovered-runtime-function",
        severity: "warning",
        confidence: "high",
        file,
        location: location ?? {
          start: { line, column: 0 },
          end: { line, column: 0 },
        },
        message: `c8 reports an uncovered function in ${displayFile}`,
        evidence: {
          source: "c8",
          kind: "function",
          function: functionRecord?.name ?? id,
          count,
          coverageFile: "coverage-final.json",
        },
      });
    }

    for (const [id, counts] of Object.entries(value.b ?? {})) {
      const branch = value.branchMap?.[id];
      if (!branch) continue;
      counts.forEach((count, index) => {
        const location = branch.locations?.[index];
        const line = location?.start.line ?? branch.line;
        if (count > 0 || !line || ignored.has(line)) return;
        adapter.emitFinding({
          rule: "uncovered-runtime-branch",
          severity: "warning",
          confidence: "high",
          file,
          location: location ?? {
            start: { line, column: 0 },
            end: { line, column: 0 },
          },
          message: `c8 reports an uncovered branch in ${displayFile}`,
          evidence: {
            source: "c8",
            kind: "branch",
            branch: id,
            location: index,
            count,
            coverageFile: "coverage-final.json",
          },
        });
      });
    }
  }
}

export const C8Plugin: AnalyzerPlugin = {
  name: "c8-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    for (const configFile of C8_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }
    const pkg = await adapter.readJson("package.json");
    if (!pkg) return false;
    if (pkg.c8) return true;
    const hasDep = [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies].some(
      (deps) => deps && deps[C8_PACKAGE_NAME],
    );
    if (hasDep) return true;
    return Object.values(pkg.scripts ?? {}).some(
      (script) => typeof script === "string" && /\bc8\b/.test(script),
    );
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      let hasConfigFile = false;

      for (const configFile of C8_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      for (const configFile of [".c8rc", ".c8rc.json"]) {
        const config = await adapter.readJson(configFile);
        if (config) extractReporterPackages(config, adapter);
      }

      const isDep = !![pkg?.dependencies, pkg?.devDependencies, pkg?.peerDependencies].some(
        (deps) => deps && deps[C8_PACKAGE_NAME],
      );

      if (pkg && isDep) adapter.markPackageAsUsed(C8_PACKAGE_NAME);

      if (pkg?.c8) {
        hasConfigFile = true;
        adapter.markAsUsed("package.json", "c8");
        extractReporterPackages(pkg.c8, adapter);
      }

      for (const [scriptName, scriptContent] of Object.entries(pkg?.scripts ?? {})) {
        if (typeof scriptContent === "string" && /\bc8\b/.test(scriptContent)) {
          adapter.markAsUsed("package.json", `scripts:${scriptName}`);
          adapter.markPackageAsUsed(C8_PACKAGE_NAME);
        }
      }

      if (hasConfigFile && !isDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "c8 configuration found, but 'c8' is not listed in package.json.",
          evidence: { hasConfigFile },
        });
      }

      await ingestCoverage(adapter);
    },

    onFileStart: (fileId, adapter) => {
      if (C8_CONFIG_FILES.includes(path.basename(fileId.replace(/\\/g, "/")))) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed(C8_PACKAGE_NAME);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      if (!C8_CONFIG_FILES.includes(path.basename(fileId.replace(/\\/g, "/")))) return;

      if (
        t.isImportDeclaration(node) &&
        typeof node.source.value === "string" &&
        !node.source.value.startsWith(".")
      ) {
        adapter.markPackageAsUsed(node.source.value);
        adapter.markAsUsed(fileId);
      }

      if (t.isExportDefaultDeclaration(node)) {
        adapter.markAsUsed(fileId, "default");
        extractReporterPackages(node.declaration, adapter);
      }
    },
  },
};

export default C8Plugin;
