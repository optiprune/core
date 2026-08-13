import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const TYPEORM_CONFIG_FILES = [
  "ormconfig.json",
  "ormconfig.js",
  "ormconfig.cjs",
  "ormconfig.mjs",
  "ormconfig.ts",
  "ormconfig.yml",
  "ormconfig.yaml",
  "data-source.ts",
  "data-source.js"
];

const TYPEORM_DRIVERS = [
  "pg",
  "pg-native",
  "mysql",
  "mysql2",
  "mariadb",
  "sqlite3",
  "better-sqlite3",
  "mssql",
  "oracledb",
  "mongodb",
  "sql.js"
];

const TYPEORM_DECORATORS = new Set([
  "Entity",
  "ChildEntity",
  "TableInheritance",
  "Column",
  "PrimaryColumn",
  "PrimaryGeneratedColumn",
  "CreateDateColumn",
  "UpdateDateColumn",
  "DeleteDateColumn",
  "VersionColumn",
  "ManyToOne",
  "OneToMany",
  "OneToOne",
  "ManyToMany",
  "JoinColumn",
  "JoinTable"
]);

export const TypeOrmPlugin: AnalyzerPlugin = {
  name: "typeorm-plugin",
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
          (dep) => dep === "typeorm" || dep === "@nestjs/typeorm"
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" && (s.includes("typeorm ") || s === "typeorm")
          )
        ) {
          return true;
        }
      }
    }

    for (const configFile of TYPEORM_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return (
      (await adapter.folderExists("src/entity")) ||
      (await adapter.folderExists("src/entities")) ||
      (await adapter.folderExists("src/migration")) ||
      (await adapter.folderExists("src/migrations"))
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

      const hasTypeOrm = Object.keys(allDeps).some(
        (p) => p === "typeorm" || p === "@nestjs/typeorm"
      );

      // 1. Safeguard installed TypeORM core, NestJS integration, and drivers in package.json
      if (hasTypeOrm) {
        adapter.markPackageAsUsed("typeorm");
        // Package declaration alone is not usage evidence.
      }

      // 2. Protect standalone configuration files and migration directories
      let hasConfigFile = false;
      for (const configFile of TYPEORM_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      for (const dir of [
        "src/migration",
        "src/migrations",
        "migration",
        "migrations",
        "src/entity",
        "src/entities"
      ]) {
        if (await adapter.folderExists(dir)) {
          adapter.markAsUsed(dir);
        }
      }

      // 3. Track npm scripts invoking TypeORM CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("typeorm ") || scriptContent === "typeorm")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("typeorm");
          }
        }
      }

      // 4. Report missing dependency if config exists without typeorm package
      if (hasConfigFile && !hasTypeOrm) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "TypeORM configuration found, but 'typeorm' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect TypeORM configuration files
      if (TYPEORM_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("typeorm");
      }

      // Protect migration and entity files
      if (
        normalized.includes("/migration/") ||
        normalized.includes("/migrations/") ||
        normalized.includes("/entity/") ||
        normalized.includes("/entities/")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("typeorm");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = TYPEORM_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for typeorm or @nestjs/typeorm
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "typeorm" || source === "@nestjs/typeorm") {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect TypeORM Decorators (@Entity(), @Column(), etc.)
// 2. Detect TypeORM Decorators (@Entity, @Column, @PrimaryGeneratedColumn, etc.)
      const decorators = (node as { decorators?: any[] }).decorators;
      if (Array.isArray(decorators) && decorators.length > 0) {
        for (const dec of decorators) {
          if (t.isDecorator(dec)) {
            const expr = dec.expression;
            let decName: string | null = null;

            if (t.isCallExpression(expr) && t.isIdentifier(expr.callee)) {
              decName = expr.callee.name;
            } else if (t.isIdentifier(expr)) {
              decName = expr.name;
            }

            if (decName && TYPEORM_DECORATORS.has(decName)) {
              adapter.markAsUsed(fileId);
              if (t.isClassDeclaration(node) && node.id) {
                adapter.markAsUsed(fileId, node.id.name);
              }
              adapter.markPackageAsUsed("typeorm");
              break;
            }
          }
        }
      }
      // 3. Inspect TypeORM DataSource / configuration objects
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("typeorm");
        }

        // Detect new DataSource({ type: 'postgres', ... })
        if (
          t.isNewExpression(node) &&
          t.isIdentifier(node.callee) &&
          node.callee.name === "DataSource"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("typeorm");

          const arg = node.arguments[0];
          if (t.isObjectExpression(arg)) {
            arg.properties.forEach((prop: any) => {
              if (
                t.isObjectProperty(prop) &&
                t.isIdentifier(prop.key) &&
                prop.key.name === "type" &&
                t.isStringLiteral(prop.value)
              ) {
                adapter.markPackageAsUsed(prop.value.value);
              }
            });
          }
        }
      }
    }
  }
};

export default TypeOrmPlugin;