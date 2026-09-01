import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const ASTRO_CONFIG_FILES = [
  "astro.config.mjs",
  "astro.config.js",
  "astro.config.ts",
  "astro.config.cjs",
  "astro.config.mts",
];

const MARKDOC_CONFIG_FILES = [
  "markdoc.config.mjs",
  "markdoc.config.js",
  "markdoc.config.ts",
  "markdoc.config.cjs",
];

const ASTRO_DB_FILES = ["db/config.ts", "db/config.js", "db/seed.ts", "db/seed.js"];

const ASTRO_API_EXPORTS = new Set([
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "HEAD",
  "OPTIONS",
  "ALL",
  "getStaticPaths",
  "prerender",
]);

/**
 * Normalizes package names from subpath imports (e.g., "@astrojs/starlight/components" -> "@astrojs/starlight")
 */
function extractPackageName(specifier: string): string | null {
  if (!specifier || specifier.startsWith(".") || specifier.startsWith("/")) return null;
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  return specifier.split("/")[0] || null;
}

/**
 * Normalizes and extracts package dependencies from Starlight or Markdoc customCss options
 */
function isUnderscoreRoute(normalizedFileId: string): boolean {
  const marker = normalizedFileId.includes("/src/pages/")
    ? "/src/pages/"
    : normalizedFileId.includes("/src/routes/")
      ? "/src/routes/"
      : normalizedFileId.startsWith("src/pages/")
        ? "src/pages/"
        : normalizedFileId.startsWith("src/routes/")
          ? "src/routes/"
          : null;
  if (!marker) return false;
  const routePath = normalizedFileId.slice(normalizedFileId.indexOf(marker) + marker.length);
  return routePath.split("/").some((segment) => segment.startsWith("_"));
}

function markCssDependency(cssEntry: string, sourceFileId: string, adapter: any): void {
  if (!cssEntry.startsWith(".") && !cssEntry.startsWith("/")) {
    const pkgName = extractPackageName(cssEntry);
    if (pkgName) {
      adapter.markPackageAsUsed(pkgName);
    }
  } else {
    adapter.markRelativeFileAsUsed(sourceFileId, cssEntry);
  }
}

export const AstroPlugin: AnalyzerPlugin = {
  name: "astro-plugin",
  version: "1.5.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    const allDeps = {
      ...pkg?.dependencies,
      ...pkg?.devDependencies,
      ...pkg?.peerDependencies,
    };
    if ("astro" in allDeps) adapter.declareFramework("astro");

    // 1. Check for dedicated Astro, Markdoc, Starlight, or DB folders/files
    if (
      (await adapter.folderExists("src/pages")) ||
      (await adapter.folderExists("src/content")) ||
      (await adapter.folderExists("src/content/docs")) ||
      (await adapter.folderExists("db"))
    ) {
      return true;
    }

    // 2. Check for Astro/Markdoc configuration files
    for (const file of [...ASTRO_CONFIG_FILES, ...MARKDOC_CONFIG_FILES]) {
      if (await adapter.folderExists(file)) return true;
    }

    // 3. Check package.json dependencies
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (
        "astro" in allDeps ||
        "@astrojs/markdoc" in allDeps ||
        "@astrojs/db" in allDeps ||
        "astro-og-canvas" in allDeps ||
        Object.keys(allDeps).some(
          (dep) => dep.startsWith("@astrojs/") || dep.startsWith("starlight-"),
        )
      ) {
        return true;
      }
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

      const hasAstroDep = !!allDeps["astro"];

      let hasConfigFile = false;
      for (const file of ASTRO_CONFIG_FILES) {
        const source = await adapter.readFile(file);
        if (source !== null) {
          hasConfigFile = true;
          adapter.markAsUsed(file);
          for (const line of source.split(/\r?\n/)) {
            if (!line.includes("@/") && !line.includes("alias")) continue;
            const target = [...line.matchAll(/["']([^"']+\.(?:ts|tsx|js|jsx|vue))["']/g)].at(-1)?.[1];
            if (target) {
              adapter.addEntryPatterns([target]);
              adapter.markAsUsed(target);
            }
          }
        }
      }

      // A Markdoc-only configuration uses @astrojs/markdoc directly but does
      // not imply a direct runtime use of the core astro package.
      const hasMarkdocConfig = (await Promise.all(
        MARKDOC_CONFIG_FILES.map((file) => adapter.folderExists(file)),
      )).some(Boolean);
      if (hasAstroDep && (hasConfigFile || !hasMarkdocConfig)) {
        adapter.markPackageAsUsed("astro");
      }

      // Protect Markdoc config file if present
      for (const file of MARKDOC_CONFIG_FILES) {
        if (await adapter.folderExists(file)) {
          adapter.markAsUsed(file);
          adapter.markPackageAsUsed("@astrojs/markdoc");
        }
      }

      // Protect Astro DB files if present
      for (const file of ASTRO_DB_FILES) {
        if (await adapter.folderExists(file)) {
          adapter.markAsUsed(file);
          adapter.markPackageAsUsed("@astrojs/db");
        }
      }

      // Protect Starlight docs & i18n content directories if present
      if (await adapter.folderExists("src/content/docs")) {
        adapter.markAsUsed("src/content/docs");
        adapter.markPackageAsUsed("@astrojs/starlight");
      }
      if (await adapter.folderExists("src/content/i18n")) {
        adapter.markAsUsed("src/content/i18n");
      }

      // Check npm scripts invoking astro or astro db CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("astro") ||
              scriptContent.includes("starlight") ||
              scriptContent.includes("astro db"))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("astro");
          }
        }
      }

      if (hasConfigFile && !hasAstroDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Astro configuration found but 'astro' is not listed in package.json.",
          evidence: { hasConfigFile },
        });
      }
    },

    onFileStart: async (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const fileName = path.basename(normalized);

      // 1. Mark .astro component/page files and Markdoc .mdoc files
      if (normalized.endsWith(".astro") || normalized.endsWith(".mdoc")) {
        if (!isUnderscoreRoute(normalized)) {
          adapter.markAsUsed(fileId);
        }
        adapter.markPackageAsUsed("astro");

        if (normalized.endsWith(".astro")) {
          const source = await adapter.readFile(fileId);
          if (source) {
            const styleImportPattern = /@(use|import|require)\s+["']([^"']+)["']/g;
            for (const match of source.matchAll(styleImportPattern)) {
              const specifier = match[2];
              if (specifier && /^\.?\/?[^@][^:]*$/.test(specifier)) {
                const candidates = new Set([
                  specifier,
                  `${specifier}.scss`,
                  `${specifier}.less`,
                  `${specifier}.styl`,
                  `${specifier}.css`,
                ]);
                const lastSlash = specifier.lastIndexOf("/");
                const baseName = lastSlash >= 0 ? specifier.slice(lastSlash + 1) : specifier;
                if (!baseName.startsWith("_")) {
                  candidates.add(
                    `${lastSlash >= 0 ? specifier.slice(0, lastSlash + 1) : "_"}_${baseName}.scss`,
                  );
                }
                for (const candidate of candidates) {
                  adapter.markRelativeFileAsUsed(fileId, candidate);
                }
              }
            }
          }
        }
        if (normalized.endsWith(".mdoc")) {
          adapter.markPackageAsUsed("@astrojs/markdoc");
        }
      }

      // 2. Mark Astro route pages & Starlight/Markdoc docs (src/pages/, src/routes/, src/content/docs/)
      if (
        (normalized.includes("/src/pages/") || normalized.includes("/src/routes/")) &&
          !isUnderscoreRoute(normalized) ||
        normalized.includes("/src/content/docs/") ||
        normalized.includes("/src/content/i18n/")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("astro");
      }

      // 3. Mark Content Collections config (src/content/config.ts or src/content.config.ts)
      if (
        normalized.endsWith("src/content/config.ts") ||
        normalized.endsWith("src/content/config.js") ||
        normalized.endsWith("src/content.config.ts") ||
        normalized.endsWith("src/content.config.js")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("astro");
      }

      // 4. Mark Astro Middleware and Actions
      if (
        normalized.endsWith("src/middleware.ts") ||
        normalized.endsWith("src/middleware.js") ||
        normalized.includes("/src/actions/")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("astro");
      }

      // 5. Mark Astro DB files (db/config.ts, db/seed.ts)
      if (ASTRO_DB_FILES.includes(normalized) || normalized.startsWith("db/")) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@astrojs/db");
      }

      // 6. Mark astro-og-canvas dynamic route files (e.g., src/pages/open-graph/[...path].ts)
      if (normalized.includes("open-graph") || normalized.includes("og-image")) {
        adapter.markAsUsed(fileId);
      }

      // 7. Mark config files and resolve Vite aliases declared in Astro config.
      if (ASTRO_CONFIG_FILES.includes(fileName) || MARKDOC_CONFIG_FILES.includes(fileName)) {
        adapter.markAsUsed(fileId);
        if (ASTRO_CONFIG_FILES.includes(fileName)) {
          const source = await adapter.readFile(fileId);
          if (source) {
            const aliasLines = source.split(/\r?\n/);
            for (const line of aliasLines) {
              if (!line.includes("alias") && !line.includes("@/")) continue;
              const aliasMatch = line.match(/["']([^"']+)["']\s*:/);
              const targetMatches = [...line.matchAll(/["']([^"']+\.(?:ts|tsx|js|jsx|vue))["']/g)];
              const target = targetMatches.at(-1)?.[1];
              if (aliasMatch?.[1] && target) adapter.markRelativeFileAsUsed(fileId, target);
            }
          }
        }
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const fileName = path.basename(normalized);
      const isConfigFile = ASTRO_CONFIG_FILES.includes(fileName);

      // 1. Detect Astro, Markdoc, DB, OG Canvas, and integration module imports
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source) {
          if (source.startsWith("astro:")) {
            adapter.markPackageAsUsed("astro");
            adapter.markAsUsed(fileId);
          } else {
            const pkgName = extractPackageName(source);
            if (
              pkgName &&
              (pkgName.startsWith("@astrojs/") ||
                pkgName.startsWith("starlight-") ||
                pkgName.startsWith("@expressive-code/") ||
                pkgName === "astro-og-canvas" ||
                pkgName === "astro")
            ) {
              adapter.markPackageAsUsed(pkgName);
              adapter.markPackageAsUsed("astro");
              adapter.markAsUsed(fileId);
            }
          }
        }
      }

      // 2. Detect CJS require(...) calls in Astro/Markdoc config files
      if (
        isConfigFile &&
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (t.isStringLiteral(arg)) {
          const pkgName = extractPackageName(arg.value);
          if (pkgName) {
            adapter.markPackageAsUsed(pkgName);
            adapter.markAsUsed(fileId);
          }
        }
      }

      // 3. Detect Astro API route exports (GET, POST, getStaticPaths, prerender)
      if (t.isExportNamedDeclaration(node) && node.declaration) {
        const decl = node.declaration;

        if (t.isFunctionDeclaration(decl) && decl.id) {
          if (ASTRO_API_EXPORTS.has(decl.id.name)) {
            adapter.markAsUsed(fileId, decl.id.name);
          }
        }

        if (t.isVariableDeclaration(decl)) {
          decl.declarations.forEach((vDecl: any) => {
            if (t.isIdentifier(vDecl.id) && ASTRO_API_EXPORTS.has(vDecl.id.name)) {
              adapter.markAsUsed(fileId, vDecl.id.name);
            }
          });
        }
      }

      // 4. Detect Astro DB exports (export default defineDb({ ... })) in db/config.ts or db/seed.ts
      if (ASTRO_DB_FILES.includes(normalized) || normalized.startsWith("db/")) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("@astrojs/db");
        }
      }

      // 5. Detect markdoc.config.* default export
      if (MARKDOC_CONFIG_FILES.includes(fileName)) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("@astrojs/markdoc");
        }
      }

      // 6. Detect Astro global usages (Astro.props, Astro.redirect, Astro.glob)
      if (t.isIdentifier(node) && node.name === "Astro") {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("astro");
      }

      // 7. Detect Astro client directives in JSX (client:load, client:visible, client:only)
      if (t.isJSXAttribute(node)) {
        const attrName = (node.name as any)?.name;
        if (attrName && attrName.startsWith("client:")) {
          adapter.markAsUsed(fileId);
        }
      }

      // 8. Handle astro.config.* exports & Starlight config options
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }

        // Detect starlight({ ... }) call inside integrations array
        if (
          t.isCallExpression(node) &&
          t.isIdentifier(node.callee) &&
          node.callee.name === "starlight"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("@astrojs/starlight");

          if (node.arguments[0] && t.isObjectExpression(node.arguments[0])) {
            const configObj = node.arguments[0];
            for (const prop of configObj.properties) {
              if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                if (prop.key.name === "customCss" && t.isArrayExpression(prop.value)) {
                  for (const el of prop.value.elements) {
                    if (t.isStringLiteral(el)) {
                      markCssDependency(el.value, fileId, adapter);
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
  },
};

export default AstroPlugin;
