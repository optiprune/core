import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const DRIZZLE_CONFIG_FILES = [
  "drizzle.config.ts",
  "drizzle.config.js",
  "drizzle.config.mjs",
  "drizzle.config.cjs",
  "drizzle.config.mts",
  "drizzle.config.cts",
  "drizzle.config.json"
];

const DRIZZLE_PACKAGES = [
  "drizzle-orm",
  "drizzle-kit",
  "drizzle-zod",
  "drizzle-valibot",
  "@libsql/client",
  "postgres",
  "pg",
  "mysql2",
  "better-sqlite3"
];

const DRIZZLE_SCHEMA_PATTERNS = [
  "/schema/",
  "/db/schema",
  "/models/",
  "schema.ts",
  "schema.js"
];

export const DrizzlePlugin: AnalyzerPlugin = {
  name: "drizzle-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (
        Object.keys(allDeps).some(
          (dep) => dep === "drizzle-orm" || dep === "drizzle-kit"
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
              (s.includes("drizzle-kit") || s.includes("drizzle-orm"))
          )
        ) {
          return true;
        }
      }
    }

    for (const configFile of DRIZZLE_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return (
      (await adapter.folderExists("drizzle")) ||
      (await adapter.folderExists("src/db")) ||
      (await adapter.folderExists("db"))
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

      const hasDrizzle =
        "drizzle-orm" in allDeps || "drizzle-kit" in allDeps;

      // 1. Safeguard installed Drizzle ecosystem packages in package.json
      if (hasDrizzle) {
        for (const depName of DRIZZLE_PACKAGES) {
          if (allDeps[depName]) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }

      // 2. Protect config files and migration directories
      let hasConfigFile = false;
      for (const configFile of DRIZZLE_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      if (await adapter.folderExists("drizzle")) {
        adapter.markAsUsed("drizzle");
      }

      // 3. Track npm scripts invoking Drizzle Kit CLI (e.g., "db:push": "drizzle-kit push")
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            scriptContent.includes("drizzle-kit")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("drizzle-kit");
          }
        }
      }

      // 4. Report missing dependency if configuration exists without drizzle-kit
      if (hasConfigFile && !hasDrizzle) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Drizzle configuration found, but 'drizzle-kit' or 'drizzle-orm' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Configuration files
      if (DRIZZLE_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("drizzle-kit");
      }

      // 2. Database schemas and migrations directory
      if (
        DRIZZLE_SCHEMA_PATTERNS.some((pattern) => normalized.includes(pattern)) ||
        normalized.includes("/drizzle/")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("drizzle-orm");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = DRIZZLE_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for drizzle-orm and drizzle-kit submodules
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          source === "drizzle-orm" ||
          source.startsWith("drizzle-orm/") ||
          source === "drizzle-kit" ||
          source.startsWith("drizzle-kit/") ||
          source.startsWith("drizzle-zod") ||
          source.startsWith("drizzle-valibot")
        ) {
          adapter.markPackageAsUsed(source.split("/")[0] ?? source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In Drizzle configuration files (drizzle.config.ts)
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("drizzle-kit");
        }

        // Detect defineConfig(...) call expression
        if (
          t.isCallExpression(node) &&
          t.isIdentifier(node.callee) &&
          node.callee.name === "defineConfig"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("drizzle-kit");
        }

        // Extract schema property in config: schema: "./src/db/schema.ts"
        if (
          t.isObjectProperty(node) &&
          t.isIdentifier(node.key) &&
          node.key.name === "schema"
        ) {
          const val = node.value;
          if (t.isStringLiteral(val)) {
            adapter.markAsUsed(val.value);
          } else if (t.isArrayExpression(val)) {
            val.elements.forEach((el: any) => {
              if (t.isStringLiteral(el)) {
                adapter.markAsUsed(el.value);
              }
            });
          }
        }

        // Extract out (migrations) directory: out: "./drizzle"
        if (
          t.isObjectProperty(node) &&
          t.isIdentifier(node.key) &&
          node.key.name === "out"
        ) {
          if (t.isStringLiteral(node.value)) {
            adapter.markAsUsed(node.value.value);
          }
        }
      }

      // 3. Detect Drizzle table definitions: pgTable(), mysqlTable(), sqliteTable()
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        ["pgTable", "mysqlTable", "sqliteTable", "pgEnum", "pgSchema"].includes(
          node.callee.name
        )
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("drizzle-orm");
      }
    }
  }
};

export default DrizzlePlugin;