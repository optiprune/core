import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const PRISMA_SCHEMA_FILES = [
  "prisma/schema.prisma",
  "schema.prisma"
];

const PRISMA_PACKAGES = [
  "prisma",
  "@prisma/client",
  "@prisma/instrumentation",
  "@prisma/debug",
  "@prisma/engines",
  "@prisma/internals"
];

export const PrismaPlugin: AnalyzerPlugin = {
  name: "prisma-plugin",
  version: "1.2.0",

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
          (dep) =>
            dep === "prisma" ||
            dep.startsWith("@prisma/") ||
            dep.startsWith("prisma-")
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (s.includes("prisma ") || s === "prisma")
          )
        ) {
          return true;
        }
      }
    }

    for (const schemaFile of PRISMA_SCHEMA_FILES) {
      if (await adapter.folderExists(schemaFile)) return true;
    }

    return (
      (await adapter.folderExists("prisma")) ||
      (await adapter.folderExists("prisma/schema"))
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

      const hasPrisma = Object.keys(allDeps).some(
        (p) =>
          p === "prisma" ||
          p.startsWith("@prisma/") ||
          p.startsWith("prisma-")
      );

      // 1. Safeguard all installed Prisma ecosystem packages in package.json
      if (hasPrisma) {
        for (const depName of Object.keys(allDeps)) {
          if (
            depName === "prisma" ||
            depName.startsWith("@prisma/") ||
            depName.startsWith("prisma-")
          ) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }

      // 2. Protect schema files and directories
      let hasSchemaFile = false;
      for (const schemaFile of PRISMA_SCHEMA_FILES) {
        if (await adapter.folderExists(schemaFile)) {
          hasSchemaFile = true;
          adapter.markAsUsed(schemaFile);
        }
      }

      if (await adapter.folderExists("prisma/schema")) {
        hasSchemaFile = true;
        adapter.markAsUsed("prisma/schema");
      }

      // 3. Track npm scripts invoking Prisma CLI (e.g. "db:generate": "prisma generate")
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("prisma ") || scriptContent === "prisma")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("prisma");
          }
        }
      }

      // 4. Report missing dependency if schema exists without prisma or @prisma/client
      if (hasSchemaFile && !hasPrisma) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Prisma schema found, but 'prisma' or '@prisma/client' is not listed in package.json.",
          evidence: { hasSchemaFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // Protect all .prisma files (including multi-schema directories in prisma/schema/*.prisma)
      if (normalized.endsWith(".prisma") || normalized.includes("/prisma/")) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@prisma/client");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // 1. Detect ESM imports for @prisma/client or prisma packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          source === "prisma" ||
          source.startsWith("@prisma/") ||
          source.startsWith("prisma-")
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect CJS require('@prisma/client')
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (
          t.isStringLiteral(arg) &&
          (arg.value === "prisma" || arg.value.startsWith("@prisma/"))
        ) {
          adapter.markPackageAsUsed(arg.value);
          adapter.markAsUsed(fileId);
        }
      }

      // 3. Detect Prisma Client calls: prisma.user.findMany(), db.post.create()
      if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
        const innerMember = node.callee.object; // e.g. prisma.user or db.user

        if (t.isMemberExpression(innerMember)) {
          const clientObj = innerMember.object; // e.g. prisma or db
          const modelProp = innerMember.property; // e.g. user or post

          if (
            t.isIdentifier(clientObj) &&
            ["prisma", "db", "dbClient"].includes(clientObj.name) &&
            t.isIdentifier(modelProp)
          ) {
            // Mark the model (e.g., 'user', 'post') as used symbol
            adapter.markAsUsed(fileId, modelProp.name);
            adapter.markPackageAsUsed("@prisma/client");
          }
        }
      }
    }
  }
};

export default PrismaPlugin;