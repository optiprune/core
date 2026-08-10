import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const TEMPORAL_PACKAGES = [
  "@temporalio/client",
  "@temporalio/worker",
  "@temporalio/workflow",
  "@temporalio/activity",
  "@temporalio/common",
  "@temporalio/proto",
  "@temporalio/testing",
  "@temporalio/envconfig",
  "@temporalio/interceptors",
  "temporalio"
];

const TEMPORAL_CONFIG_FILES = [
  "temporal.toml",
  ".config/temporalio/temporal.toml"
];

const TEMPORAL_WORKFLOW_APIS = new Set([
  "proxyActivities",
  "proxyLocalActivities",
  "defineSignal",
  "defineQuery",
  "defineUpdate",
  "setHandler",
  "sleep",
  "condition",
  "executeChild",
  "getParentClosePolicy"
]);

export const TemporalPlugin: AnalyzerPlugin = {
  name: "temporal-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check package.json dependencies, scripts, or CLI usage
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (
        Object.keys(allDeps).some(
          (dep) => dep === "temporalio" || dep.startsWith("@temporalio/")
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" &&
              (s.includes("temporal ") ||
                s.includes("worker") ||
                s.includes("workflows"))
          )
        ) {
          return true;
        }
      }
    }

    // 2. Check for Temporal configuration files
    for (const configFile of TEMPORAL_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 3. Check for standard Temporal application structure
    return (
      (await adapter.folderExists("src/workflows")) ||
      (await adapter.folderExists("src/activities")) ||
      (await adapter.folderExists("workflows")) ||
      (await adapter.folderExists("activities"))
    );
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

      const hasTemporalDep = Object.keys(allDeps).some(
        (p) => p === "temporalio" || p.startsWith("@temporalio/")
      );

      // 1. Safeguard installed @temporalio/* packages in package.json
      if (hasTemporalDep) {
        for (const depName of Object.keys(allDeps)) {
          if (depName === "temporalio" || depName.startsWith("@temporalio/")) {
            adapter.markPackageAsUsed(depName);
          }
        }
      }

      // 2. Protect standalone config files
      let hasConfigFile = false;
      for (const configFile of TEMPORAL_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Protect conventional workflow & activity directories
      for (const dir of [
        "src/workflows",
        "src/activities",
        "workflows",
        "activities"
      ]) {
        if (await adapter.folderExists(dir)) {
          adapter.markAsUsed(dir);
        }
      }

      // 4. Track npm scripts invoking Temporal CLI or worker execution
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("temporal") ||
              scriptContent.includes("worker"))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("@temporalio/worker");
          }
        }
      }

      // 5. Report missing dependency if configuration or workflows exist without temporal packages
      const hasWorkflowDir =
        (await adapter.folderExists("src/workflows")) ||
        (await adapter.folderExists("workflows"));

      if ((hasConfigFile || hasWorkflowDir) && !hasTemporalDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Temporal configuration or workflows directory found, but '@temporalio/workflow' or '@temporalio/worker' is not listed in package.json.",
          evidence: { hasConfigFile, hasWorkflowDir }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect Temporal config files
      if (TEMPORAL_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@temporalio/client");
      }

      // Protect source files in workflow or activity directories
      if (
        normalized.includes("/workflows/") ||
        normalized.includes("/activities/") ||
        normalized.startsWith("workflows/") ||
        normalized.startsWith("activities/") ||
        normalized.startsWith("src/workflows/") ||
        normalized.startsWith("src/activities/")
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // 1. Detect ESM imports for @temporalio/* packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "temporalio" || source.startsWith("@temporalio/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect CJS require('@temporalio/*')
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (
          t.isStringLiteral(arg) &&
          (arg.value === "temporalio" || arg.value.startsWith("@temporalio/"))
        ) {
          adapter.markPackageAsUsed(arg.value);
          adapter.markAsUsed(fileId);
        }
      }

      // 3. Detect Temporal Worker creation: Worker.create({ ... })
      if (
        t.isCallExpression(node) &&
        t.isMemberExpression(node.callee) &&
        t.isIdentifier(node.callee.object) &&
        node.callee.object.name === "Worker" &&
        t.isIdentifier(node.callee.property) &&
        node.callee.property.name === "create"
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@temporalio/worker");

        // Inspect options object passed into Worker.create({ workflowsPath: '...' })
        const firstArg = node.arguments[0];
        if (t.isObjectExpression(firstArg)) {
          firstArg.properties.forEach((prop: any) => {
            if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
              if (
                ["workflowsPath", "activities"].includes(prop.key.name) &&
                t.isStringLiteral(prop.value)
              ) {
                adapter.markAsUsed(prop.value.value);
              }
            }
          });
        }
      }

      // 4. Detect exported Workflow or Activity functions in workflow/activity files
      if (
        normalized.includes("workflow") ||
        normalized.includes("activity") ||
        normalized.includes("activities")
      ) {
        // Protect export default functions
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }

        // Protect export function myWorkflow() / export const myActivity = ...
        if (t.isExportNamedDeclaration(node) && node.declaration) {
          const decl = node.declaration;

          if (t.isFunctionDeclaration(decl) && decl.id) {
            adapter.markAsUsed(fileId, decl.id.name);
          } else if (t.isVariableDeclaration(decl)) {
            decl.declarations.forEach((d: any) => {
              if (t.isIdentifier(d.id)) {
                adapter.markAsUsed(fileId, d.id.name);
              }
            });
          }
        }

        // Detect Temporal workflow API helper calls: proxyActivities({ ... }), defineSignal(...)
        if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
          if (TEMPORAL_WORKFLOW_APIS.has(node.callee.name)) {
            adapter.markAsUsed(fileId);
            adapter.markPackageAsUsed("@temporalio/workflow");
          }
        }
      }
    }
  }
};

export default TemporalPlugin;