import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const ANGULAR_CONFIG_FILES = ["angular.json", ".angular-cli.json"];

const ANGULAR_PACKAGES = [
  "@angular/core",
  "@angular/common",
  "@angular/router",
  "@angular/forms",
  "@angular/platform-browser",
  "@angular/platform-browser-dynamic",
  "@angular/compiler",
  "@angular/compiler-cli",
  "@angular/cli",
  "@angular/animations",
  "@angular/httpClient",
  "@angular/elements",
  "@angular/service-worker",
];

const ANGULAR_CLASS_DECORATORS = new Set([
  "Component",
  "Directive",
  "Injectable",
  "NgModule",
  "Pipe",
]);

const ANGULAR_MEMBER_DECORATORS = new Set([
  "Input",
  "Output",
  "ViewChild",
  "ViewChildren",
  "ContentChild",
  "ContentChildren",
  "HostListener",
  "HostBinding",
]);

const ANGULAR_FUNCTIONAL_SIGNALS = new Set([
  "input",
  "output",
  "model",
  "viewChild",
  "viewChildren",
  "contentChild",
  "contentChildren",
  "inject",
]);

/**
 * Normalizes scoped package specifiers (e.g. "@angular/core/rxjs-interop" -> "@angular/core")
 */
function extractAngularPackageName(specifier: string): string | null {
  if (!specifier || !specifier.startsWith("@angular/")) return null;
  const parts = specifier.split("/");
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
}

/**
 * Inspects @Component decorator metadata objects to extract external templates & styles
 */
function extractComponentMetadata(metadataObj: any, fileId: string, adapter: any): void {
  if (!t.isObjectExpression(metadataObj)) return;

  for (const prop of metadataObj.properties) {
    if (!t.isObjectProperty(prop)) continue;
    const keyName = prop.key?.name || prop.key?.value;

    // templateUrl: './app.component.html'
    if (keyName === "templateUrl" && t.isStringLiteral(prop.value)) {
      adapter.markRelativeFileAsUsed(fileId, prop.value.value);
    }

    // styleUrl: './app.component.scss'
    if (keyName === "styleUrl" && t.isStringLiteral(prop.value)) {
      adapter.markRelativeFileAsUsed(fileId, prop.value.value);
    }

    // styleUrls: ['./app.component.scss', './theme.css']
    if (keyName === "styleUrls" && t.isArrayExpression(prop.value)) {
      for (const el of prop.value.elements) {
        if (t.isStringLiteral(el)) {
          adapter.markRelativeFileAsUsed(fileId, el.value);
        }
      }
    }
  }
}

export const AngularPlugin: AnalyzerPlugin = {
  name: "angular-plugin",
  version: "1.3.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (ANGULAR_PACKAGES.some((pkgName) => pkgName in allDeps)) {
        return true;
      }
    }

    for (const configFile of ANGULAR_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return (
      (await adapter.findFilesByGlob(["**/*.component.ts", "**/*.directive.ts", "**/*.pipe.ts"]))
        .length > 0
    );
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies,
      };

      const hasCoreDep = "@angular/core" in allDeps;

      let hasConfigFile = false;
      for (const configFile of ANGULAR_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
          break;
        }
      }

      // Safeguard core framework package if present
      if (hasCoreDep) {
        adapter.markPackageAsUsed("@angular/core");
      }

      // Track npm scripts invoking Angular CLI (e.g. "build": "ng build")
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("ng ") || scriptContent.includes("ng build"))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("@angular/cli");
          }
        }
      }

      if (hasConfigFile && !hasCoreDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Angular configuration (angular.json) found but '@angular/core' is not listed in package.json.",
          evidence: { hasConfigFile },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const fileName = path.basename(normalized);

      // 1. Mark main bootstrapping and configuration entry points
      if (
        fileName === "main.ts" ||
        fileName === "app.config.ts" ||
        fileName === "app.routes.ts" ||
        fileName.includes("routes.ts")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@angular/core");
      }

      // 2. Mark Angular file conventions
      const angularFileConventions = [
        ".component.ts",
        ".component.html",
        ".component.scss",
        ".component.css",
        ".module.ts",
        ".service.ts",
        ".directive.ts",
        ".pipe.ts",
        ".guard.ts",
        ".interceptor.ts",
        ".resolver.ts",
      ];

      if (angularFileConventions.some((ext) => normalized.endsWith(ext))) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@angular/core");
      }

      // 3. Mark Angular config files
      if (ANGULAR_CONFIG_FILES.includes(fileName)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const decorators =
        (node as any).decorators ||
        (node as any).modifiers?.filter((m: any) => m?.type === "Decorator");

      const getDecoratorInfo = (dec: any): { name: string | null; arg: any } => {
        const expr = dec?.expression;
        const isCall = t.isCallExpression(expr);
        const callee = isCall ? expr.callee : expr;
        const arg = isCall ? expr.arguments[0] : null;

        if (t.isIdentifier(callee)) return { name: callee.name, arg };
        if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
          return { name: callee.property.name, arg };
        }
        return { name: null, arg: null };
      };

      // 1. Angular Class Decorators (@Component, @Directive, @Injectable, @NgModule, @Pipe)
      if ((t.isClassDeclaration(node) || t.isClassExpression(node)) && decorators) {
        for (const dec of decorators) {
          const { name, arg } = getDecoratorInfo(dec);
          if (name && ANGULAR_CLASS_DECORATORS.has(name)) {
            const className = (node as any).id?.name;
            if (className) {
              adapter.markAsUsed(fileId, className);
            }
            adapter.markAsUsed(fileId);
            adapter.markPackageAsUsed("@angular/core");

            // Extract external template & style assets for @Component
            if (name === "Component" && arg) {
              extractComponentMetadata(arg, fileId, adapter);
            }
          }
        }
      }

      // 2. Angular Property/Method Member Decorators (@Input, @Output, @ViewChild, @HostListener, etc.)
      if (
        (t.isClassProperty(node) ||
          t.isClassMethod(node) ||
          (node as any).type === "PropertyDefinition") &&
        decorators
      ) {
        const isAngularMember = decorators.some((dec: any) => {
          const { name } = getDecoratorInfo(dec);
          return name && ANGULAR_MEMBER_DECORATORS.has(name);
        });

        if (isAngularMember) {
          const key = (node as any).key || (node as any).id;
          if (t.isIdentifier(key)) {
            adapter.markAsUsed(fileId, key.name);
          }
          adapter.markAsUsed(fileId);
        }
      }

      // 3. Modern Functional Signals & Injections (input(), output(), inject(), viewChild())
      if (
        (t.isClassProperty(node) || (node as any).type === "PropertyDefinition") &&
        (node as any).value
      ) {
        const val = (node as any).value;
        if (t.isCallExpression(val) && t.isIdentifier(val.callee)) {
          if (ANGULAR_FUNCTIONAL_SIGNALS.has(val.callee.name)) {
            const propKey = (node as any).key;
            if (t.isIdentifier(propKey)) {
              adapter.markAsUsed(fileId, propKey.name);
            }
            adapter.markAsUsed(fileId);
            adapter.markPackageAsUsed("@angular/core");
          }
        }
      }

      // 4. Protect @angular/* imports with subpath normalization
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        const pkgName = extractAngularPackageName(source);
        if (pkgName) {
          adapter.markPackageAsUsed(pkgName);
          adapter.markAsUsed(fileId);
        }
      }
    },
  },
};

export default AngularPlugin;
