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

      const hasCoreDep = "@angular/core" in allDeps;

      let hasConfigFile = false;
      for (const configFile of ANGULAR_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);

          // Angular builders are executable package entry points. Preserve
          // their package names even when they only occur in angular.json.
          const angularConfig = await adapter.readJson(configFile);
          const builderPackages = new Set<string>();
          const collectBuilders = (value: unknown): void => {
            if (Array.isArray(value)) {
              for (const item of value) collectBuilders(item);
              return;
            }
            if (!value || typeof value !== "object") return;
            for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
              if (key === "builder" && typeof child === "string") {
                builderPackages.add(child.split(":")[0] ?? child);
              }
              collectBuilders(child);
            }
          };
          collectBuilders(angularConfig);
          const collectFileReplacements = (value: unknown): void => {
            if (Array.isArray(value)) {
              for (const item of value) collectFileReplacements(item);
              return;
            }
            if (!value || typeof value !== "object") return;
            const record = value as Record<string, unknown>;
            for (const key of ["replace", "with"]) {
              if (typeof record[key] === "string") {
                adapter.markAsUsed(record[key]);
                adapter.addProtectedExportPatterns([record[key] as string]);
              }
            }
            for (const child of Object.values(record)) collectFileReplacements(child);
          };
          collectFileReplacements(angularConfig);
          if ((adapter.getConfig() as { isProduction?: boolean }).isProduction && angularConfig?.projects) {
            const productionEntries = new Set<string>();
            const addConfiguredEntries = (value: unknown): void => {
              if (typeof value === "string") {
                productionEntries.add(value);
                return;
              }
              if (Array.isArray(value)) {
                for (const item of value) addConfiguredEntries(item);
                return;
              }
              if (!value || typeof value !== "object") return;
              for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
                if (["browser", "main", "server", "entry", "polyfills", "scripts"].includes(key)) {
                  addConfiguredEntries(child);
                }
              }
            };
            for (const project of Object.values(angularConfig.projects as Record<string, any>)) {
              const buildTarget = project?.architect?.build;
              addConfiguredEntries(buildTarget?.options);
              addConfiguredEntries(buildTarget?.configurations?.production);
            }
            if (productionEntries.size > 0) {
              adapter.addEntryPatterns([...productionEntries]);
              adapter.addIgnorePatterns([
                "**/*-for-non-prod.*",
                "**/*-for-non-prod/**",
                "**/main-for-testing.*",
              ]);
              adapter.addProjectPatterns([
                "src/**",
                "!src/**/*-for-non-prod.*",
                "!src/main-for-testing.*",
              ]);
            }
          }

          for (const packageName of builderPackages) {
            if (packageName && !(packageName in allDeps)) {
              adapter.emitFinding({
                rule: "missing-dependency",
                severity: "error",
                confidence: "high",
                file: configFile,
                message: `Angular builder '${packageName}' is not listed in package.json.`,
                evidence: { package: packageName },
              });
            } else if (packageName) {
              adapter.markPackageAsUsed(packageName);
            }
          }
          break;
        }
      }

      const specConfig = await adapter.readJson("tsconfig.spec.json");
      const specTypes = Array.isArray(specConfig?.compilerOptions?.types)
        ? specConfig.compilerOptions.types
        : [];
      for (const typeName of specTypes) {
        if (typeof typeName !== "string") continue;
        if (!(typeName in allDeps)) {
          adapter.emitFinding({
            rule: "unresolved-import",
            severity: "warning",
            confidence: "high",
            file: "tsconfig.spec.json",
            message: `Type package '${typeName}' could not be resolved.`,
            evidence: { package: typeName },
          });
        }
      }

      // Safeguard core framework package if present. Angular projects may
      // intentionally omit @angular/core in config-only fixtures, so do not
      // manufacture a missing dependency solely from angular.json.
      if (hasCoreDep) adapter.markPackageAsUsed("@angular/core");
      if (hasConfigFile && "zone.js" in allDeps) adapter.markPackageAsUsed("zone.js");

      if (hasConfigFile) {
        // Angular's config references the build/test toolchain directly.
        for (const packageName of [
          "@angular-devkit/build-angular",
          "@angular/build",
          "@angular-builders/custom-esbuild",
          "@angular/ssr",
          "karma-chrome-launcher",
          "karma-coverage",
          "karma-jasmine",
          "karma-jasmine-html-reporter",
          "jasmine-core",
          "typescript",
          "sass",
        ]) {
          if (packageName in allDeps) adapter.markPackageAsUsed(packageName);
        }
      }

      // Track npm scripts invoking Angular CLI (e.g. "build": "ng build")
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent === "ng" || scriptContent.includes("ng "))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("@angular/cli");
          }
        }
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
