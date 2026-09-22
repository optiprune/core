import { AnalyzerPlugin, PluginAdapter } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const COMMITIZEN_CORE_PACKAGES = ["commitizen", "cz-cli"];

const COMMITIZEN_CONFIG_FILES = [
  ".czrc",
  ".czrc.json",
  ".czrc.js",
  ".czrc.cjs",
  ".cz.json",
  ".cz.yaml",
  ".cz.yml",
  "cz.json",
  "cz.config.js",
  "cz.config.cjs",
  "cz.config.mjs",
  "cz.config.ts",
  ".cz-config.js",
];

const HOOK_PATTERNS = [
  ".husky/*",
  ".husky/_/*",
  ".lefthook.yml",
  "lefthook.yml",
  ".simple-git-hooks.json",
  ".simple-git-hooks.js",
];

const WORKFLOW_PATTERNS = [".github/workflows/*.{yml,yaml}", ".github/workflows/**/*.{yml,yaml}"];

function normalize(fileId: string): string {
  return fileId.replace(/\\/g, "/");
}

async function readRawFile(adapter: PluginAdapter, fileId: string): Promise<string> {
  try {
    if (typeof (adapter as any).readFile === "function") {
      const res = await (adapter as any).readFile(fileId);
      return typeof res === "string" ? res : "";
    }
    if (typeof (adapter as any).readText === "function") {
      const res = await (adapter as any).readText(fileId);
      return typeof res === "string" ? res : "";
    }
    const content = await adapter.readJson(fileId);
    return typeof content === "string" ? content : JSON.stringify(content);
  } catch {
    return "";
  }
}

function hasCommitizenDependency(packageJson: any): boolean {
  const allDeps = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies,
    ...packageJson?.peerDependencies,
    ...packageJson?.optionalDependencies,
  };
  return COMMITIZEN_CORE_PACKAGES.some((pkg) => Boolean(allDeps[pkg]));
}

function isCommitizenInvocation(content: string): boolean {
  return (
    /(?:^|[\s&|;])(?:cz|git-cz|commitizen)(?:\s|$)/.test(content) ||
    /\b(?:npx|pnpm|yarn|bunx)\s+(?:--yes\s+)?(?:cz|git-cz|commitizen)\b/.test(content) ||
    /\b(?:pnpm|yarn)\s+(?:exec|dlx)\s+(?:cz|git-cz|commitizen)\b/.test(content)
  );
}

function isGlobalOrTransientExecution(content: string): boolean {
  return (
    /\bnpx\s+(?:--yes\s+)?(?:cz|git-cz|commitizen)\b/.test(content) ||
    /\bpnpm\s+dlx\s+(?:cz|git-cz|commitizen)\b/.test(content) ||
    /\byarn\s+dlx\s+(?:cz|git-cz|commitizen)\b/.test(content) ||
    /\bbunx\s+(?:cz|git-cz|commitizen)\b/.test(content)
  );
}

function resolveCommitizenAdapter(
  pathOrPkg: string,
  baseDir: string,
  adapter: PluginAdapter,
): void {
  if (!pathOrPkg || typeof pathOrPkg !== "string") return;

  if (pathOrPkg.startsWith(".") && !pathOrPkg.includes("node_modules")) {
    const localPath = path.resolve(baseDir, pathOrPkg);
    adapter.markAsUsed(localPath);
    return;
  }

  let pkgName = pathOrPkg;
  if (pkgName.includes("node_modules/")) {
    pkgName = pkgName.split("node_modules/").pop() || pkgName;
  }

  const segments = pkgName.split("/").filter(Boolean);
  if (segments[0]?.startsWith("@")) {
    pkgName = segments.slice(0, 2).join("/");
  } else {
    pkgName = segments[0] || pkgName;
  }

  adapter.markPackageAsUsed(pkgName);
}

function parseAndProcessConfigContent(
  rawContent: string,
  isJsonLike: boolean,
  baseDir: string,
  adapter: PluginAdapter,
): void {
  if (!rawContent || typeof rawContent !== "string") return;
  const trimmed = rawContent.trim();

  // Try JSON first if it looks like JSON or is json-like
  if (isJsonLike || trimmed.startsWith("{")) {
    try {
      const config = JSON.parse(trimmed);
      if (config && typeof config === "object" && typeof config.path === "string") {
        resolveCommitizenAdapter(config.path, baseDir, adapter);
        return;
      }
    } catch {
      // Fall through to YAML/text fallback parser if JSON parse fails
    }
  }

  // YAML / text fallback parser for key-values like `path: "..."` or `path: '...'`
  const lines = rawContent.split(/\r?\n/);
  for (const line of lines) {
    const match = /^\s*path\s*:\s*['"]?([^\r\n#'"]+)['"]?/i.exec(line);
    if (match && match[1]) {
      resolveCommitizenAdapter(match[1].trim(), baseDir, adapter);
      break;
    }
  }
}

export const CommitizenPlugin: AnalyzerPlugin = {
  name: "commitizen-plugin",
  version: "1.2.1",

  detect: async (adapter: PluginAdapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (pkg.config?.commitizen || pkg.config?.["cz-customizable"]) return true;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
        ...pkg.optionalDependencies,
      };

      if (
        Object.keys(allDeps).some(
          (dep) =>
            COMMITIZEN_CORE_PACKAGES.includes(dep) || dep.startsWith("cz-") || dep.includes("/cz-"),
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (scriptValues.some((s) => typeof s === "string" && isCommitizenInvocation(s))) {
          return true;
        }
      }
    }

    for (const configFile of COMMITIZEN_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    const hookFiles = await adapter.findFiles(HOOK_PATTERNS);
    for (const hookFile of hookFiles) {
      const raw = await readRawFile(adapter, hookFile);
      if (raw && isCommitizenInvocation(raw)) return true;
    }

    const workflowFiles = await adapter.findFiles(WORKFLOW_PATTERNS);
    for (const workflow of workflowFiles) {
      const raw = await readRawFile(adapter, workflow);
      if (raw && isCommitizenInvocation(raw)) return true;
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter: PluginAdapter) => {
      const pkg = await adapter.readJson("package.json");
      const declaredCommitizen = hasCommitizenDependency(pkg);

      let hasConfigFile = false;
      let hasScriptInvocation = false;
      let hasHookInvocation = false;
      let hasWorkflowInvocation = false;
      let onlyTransientInvocation = true;

      // 1. Mark dedicated config files and parse contents robustly
      for (const configFile of COMMITIZEN_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);

          const raw = await readRawFile(adapter, configFile);
          const isJsonLike =
            configFile.endsWith(".json") || configFile === ".cz.json" || raw.trim().startsWith("{");
          parseAndProcessConfigContent(raw, isJsonLike, ".", adapter);
        }
      }

      // 2. Inline package.json configurations
      if (pkg?.config?.commitizen) {
        adapter.markAsUsed("package.json", "config.commitizen");
        if (typeof pkg.config.commitizen === "object" && pkg.config.commitizen !== null) {
          if (typeof pkg.config.commitizen.path === "string") {
            resolveCommitizenAdapter(pkg.config.commitizen.path, ".", adapter);
          }
        } else if (typeof pkg.config.commitizen === "string") {
          resolveCommitizenAdapter(pkg.config.commitizen, ".", adapter);
        }
      }

      if (pkg?.config?.["cz-customizable"]) {
        adapter.markAsUsed("package.json", "config:cz-customizable");
        adapter.markPackageAsUsed("cz-customizable");
      }

      // 3. Mark package.json scripts executing Commitizen CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (typeof scriptContent === "string" && isCommitizenInvocation(scriptContent)) {
            hasScriptInvocation = true;
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);

            if (!isGlobalOrTransientExecution(scriptContent)) {
              onlyTransientInvocation = false;
            }
          }
        }
      }

      // 4. Git hook configurations
      const hookFiles = await adapter.findFiles(HOOK_PATTERNS);
      for (const hookFile of hookFiles) {
        const raw = await readRawFile(adapter, hookFile);
        if (raw && isCommitizenInvocation(raw)) {
          hasHookInvocation = true;
          adapter.markAsUsed(hookFile);
          if (!isGlobalOrTransientExecution(raw)) {
            onlyTransientInvocation = false;
          }
        }
      }

      // 5. GitHub Actions workflows
      const workflowFiles = await adapter.findFiles(WORKFLOW_PATTERNS);
      for (const workflow of workflowFiles) {
        const raw = await readRawFile(adapter, workflow);
        if (raw && isCommitizenInvocation(raw)) {
          hasWorkflowInvocation = true;
          adapter.markAsUsed(workflow);
        }
      }

      const isUsedInProject =
        hasConfigFile ||
        Boolean(pkg?.config?.commitizen) ||
        hasScriptInvocation ||
        hasHookInvocation ||
        hasWorkflowInvocation;

      // 6. Mark installed Commitizen packages as used
      if (isUsedInProject && declaredCommitizen) {
        const allDeps = {
          ...pkg?.dependencies,
          ...pkg?.devDependencies,
          ...pkg?.peerDependencies,
          ...pkg?.optionalDependencies,
        };
        for (const pkgName of COMMITIZEN_CORE_PACKAGES) {
          if (allDeps[pkgName]) {
            adapter.markPackageAsUsed(pkgName);
          }
        }
      }

      // 7. Report missing dependency if locally required without a transient runner
      const requiresLocalDep =
        hasConfigFile || hasHookInvocation || (hasScriptInvocation && !onlyTransientInvocation);

      if (isUsedInProject && !declaredCommitizen && requiresLocalDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Commitizen script or configuration found, but 'commitizen' is not listed in package.json.",
          evidence: {
            hasConfigFile,
            hasPkgBlock: Boolean(pkg?.config?.commitizen),
            hasScriptInvocation,
            hasHookInvocation,
          },
        });
      }
    },

    onFileStart: (fileId: string, adapter: PluginAdapter) => {
      const normalized = normalize(fileId);
      const basename = path.basename(normalized);
      if (COMMITIZEN_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: unknown, fileId: string, adapter: PluginAdapter) => {
      const normalized = normalize(fileId);
      const basename = path.basename(normalized);
      const isConfigFile =
        basename.startsWith("cz.config.") ||
        basename.startsWith(".czrc.") ||
        basename === ".cz-config.js";

      // 1. Inspect JS/TS config files
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node) || t.isExportNamedDeclaration(node)) {
          adapter.markAsUsed(fileId);
        }

        if (t.isAssignmentExpression(node) && t.isMemberExpression(node.left)) {
          const isModule = t.isIdentifier(node.left.object) && node.left.object.name === "module";
          const isExports =
            (t.isIdentifier(node.left.property) && node.left.property.name === "exports") ||
            (t.isStringLiteral(node.left.property) && node.left.property.value === "exports");

          if (isModule && isExports) {
            adapter.markAsUsed(fileId);
          }
        }

        if (t.isObjectProperty(node)) {
          const isPathKey =
            (t.isIdentifier(node.key) && node.key.name === "path") ||
            (t.isStringLiteral(node.key) && node.key.value === "path");

          if (isPathKey && t.isStringLiteral(node.value)) {
            resolveCommitizenAdapter(node.value.value, path.dirname(fileId), adapter);
          }
        }
      }

      // 2. Retain imports from commitizen, cz-cli, or cz-* adapter packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          COMMITIZEN_CORE_PACKAGES.includes(source) ||
          source.startsWith("cz-") ||
          source.includes("/cz-")
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 3. Retain CJS require calls
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (
          t.isStringLiteral(arg) &&
          (COMMITIZEN_CORE_PACKAGES.includes(arg.value) ||
            arg.value.startsWith("cz-") ||
            arg.value.includes("/cz-"))
        ) {
          adapter.markPackageAsUsed(arg.value);
          adapter.markAsUsed(fileId);
        }
      }
    },
  },
};

export default CommitizenPlugin;
