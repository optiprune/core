import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const NEST_CONFIG_FILES = ["nest-cli.json", ".nestcli.json"];

const NEST_ECOSYSTEM_PACKAGES = [
  "@nestjs/core",
  "@nestjs/common",
  "@nestjs/microservices",
  "@nestjs/websockets",
  "@nestjs/graphql",
  "@nestjs/swagger",
  "@nestjs/typeorm",
  "@nestjs/mongoose",
  "@nestjs/jwt",
  "@nestjs/passport",
  "@nestjs/config",
  "@nestjs/cqrs",
  "@nestjs/schedule",
  "@nestjs/bull",
  "@nestjs/terminus",
];

const CLASS_DECORATORS = new Set([
  "Controller",
  "Injectable",
  "Module",
  "Catch",
  "Resolver",
  "WebSocketGateway",
  "Processor",
  "ObjectType",
  "InputType",
  "ArgsType",
  "InterfaceType",
]);

const METHOD_DECORATORS = new Set([
  // HTTP
  "Get",
  "Post",
  "Put",
  "Delete",
  "Patch",
  "Options",
  "Head",
  "All",
  // Microservices / WebSockets
  "MessagePattern",
  "EventPattern",
  "GrpcMethod",
  "SubscribeMessage",
  // GraphQL
  "Query",
  "Mutation",
  "Subscription",
  "ResolveField",
  // Task Scheduling / CQRS
  "Cron",
  "Interval",
  "Timeout",
  "CommandHandler",
  "QueryHandler",
  "EventHandler",
]);

const PROPERTY_PARAM_DECORATORS = new Set([
  "Inject",
  "InjectRepository",
  "InjectModel",
  "InjectConnection",
  "InjectQueue",
  "ApiProperty",
  "ApiPropertyOptional",
  "Field",
]);

export const NestJsPlugin: AnalyzerPlugin = {
  name: "nestjs-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (NEST_ECOSYSTEM_PACKAGES.some((pkgName) => pkgName in allDeps)) {
        return true;
      }
    }

    for (const configFile of NEST_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies,
      };

      const hasNestDep = NEST_ECOSYSTEM_PACKAGES.some((p) => p in allDeps);

      let hasConfigFile = false;
      for (const configFile of NEST_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markConfigFileAsUsed(configFile);
          break;
        }
      }

      // Mark all installed @nestjs/* packages as used
      // Package manifest presence alone is not usage evidence;
      // config, script, import, and file hooks provide the usage marks.

      // Track npm scripts invoking Nest CLI (e.g. "start:dev": "nest start --watch")
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("nest ") || scriptContent.includes("nest-cli"))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
          }
        }
      }

      if (hasConfigFile && !hasNestDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "NestJS configuration (nest-cli.json) found but '@nestjs/core' is not listed in package.json.",
          evidence: { hasConfigFile },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const fileName = path.basename(normalized);

      // 1. NestJS entry points and main application bootstrapper
      if (fileName === "main.ts" || fileName === "main.js" || fileName === "app.module.ts") {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@nestjs/core");
      }

      // 2. Mark NestJS conventional file extensions as active modules/services
      const nestFileConventions = [
        ".module.ts",
        ".controller.ts",
        ".service.ts",
        ".guard.ts",
        ".interceptor.ts",
        ".pipe.ts",
        ".filter.ts",
        ".middleware.ts",
        ".strategy.ts",
        ".resolver.ts",
        ".gateway.ts",
        ".dto.ts",
      ];

      if (nestFileConventions.some((ext) => normalized.endsWith(ext))) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@nestjs/common");
      }

      // 3. Config file
      if (NEST_CONFIG_FILES.includes(fileName)) {
        adapter.markConfigFileAsUsed(fileId);
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // Extract decorators attached to class declarations, methods, properties, or parameters
      const decorators =
        (node as any).decorators ||
        (node as any).modifiers?.filter((m: any) => m.type === "Decorator");

      // Helper to extract decorator name cleanly
      const getDecoratorName = (dec: any): string | null => {
        const expr = dec.expression;
        const callee = t.isCallExpression(expr) ? expr.callee : expr;
        if (t.isIdentifier(callee)) return callee.name;
        if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
          return callee.property.name;
        }
        return null;
      };

      // 1. Detect Class Declarations with NestJS Decorators (@Controller, @Injectable, @Module, @Resolver, etc.)
      if ((t.isClassDeclaration(node) || t.isClassExpression(node)) && decorators) {
        const hasNestDecorator = decorators.some((dec: any) => {
          const name = getDecoratorName(dec);
          return name && CLASS_DECORATORS.has(name);
        });

        if (hasNestDecorator) {
          const className = (node as any).id?.name;
          if (className) {
            adapter.markAsUsed(fileId, className);
          }
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("@nestjs/common");
        }
      }

      // 2. Detect Class Methods (@Get, @Post, @MessagePattern, @Query, @Cron, etc.)
      if ((t.isClassMethod(node) || node.type === "MethodDefinition") && decorators) {
        const hasRouteDecorator = decorators.some((dec: any) => {
          const name = getDecoratorName(dec);
          return name && METHOD_DECORATORS.has(name);
        });

        if (hasRouteDecorator) {
          const methodName = (node as any).key?.name;
          if (methodName) {
            adapter.markAsUsed(fileId, methodName);
          }
          adapter.markAsUsed(fileId);
        }
      }

      // 3. Detect Class Properties & Constructor Parameters (@Inject, @InjectRepository, @ApiProperty, @Field)
      if ((t.isClassProperty(node) || node.type === "PropertyDefinition") && decorators) {
        const hasInjectionDecorator = decorators.some((dec: any) => {
          const name = getDecoratorName(dec);
          return name && PROPERTY_PARAM_DECORATORS.has(name);
        });

        if (hasInjectionDecorator) {
          const propName = (node as any).key?.name;
          if (propName) {
            adapter.markAsUsed(fileId, propName);
          }
          adapter.markAsUsed(fileId);
        }
      }

      // 4. Detect @nestjs/* package imports
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source.startsWith("@nestjs/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }
    },
  },
};

export default NestJsPlugin;
