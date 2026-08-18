import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const MARKO_CONFIG_FILES = [
  "marko.json",
  "marko-taglib.json",
  "marko-tag.json"
];

const MARKO_ECOSYSTEM_PACKAGES = [
  "@marko/run",
  "@marko/build",
  "@marko/express",
  "@marko/fastify",
  "@marko/vite",
  "@marko/compiler",
  "@marko/webpack"
];

export const MarkoPlugin: AnalyzerPlugin = {
  name: "marko-plugin",
  version: "1.1.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (
      pkg?.dependencies?.["marko"] ||
      pkg?.devDependencies?.["marko"] ||
      pkg?.dependencies?.["@marko-js/marko"] ||
      pkg?.devDependencies?.["@marko-js/marko"] ||
      pkg?.dependencies?.["@marko/run"] ||
      pkg?.devDependencies?.["@marko/run"]
    ) {
      return true;
    }

    for (const file of MARKO_CONFIG_FILES) {
      if (await adapter.folderExists(file)) return true;
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

      const hasMarkoDep = !!(allDeps["marko"] || allDeps["@marko-js/marko"] || allDeps["@marko/run"]);
      const markoFiles = await adapter.findFilesByGlob(["**/*.marko"]);
      for (const file of markoFiles) {
        adapter.markAsUsed(file);
        adapter.markPackageAsUsed("@marko-js/marko");
      }

      let hasConfigFile = false;
      for (const file of MARKO_CONFIG_FILES) {
        if (await adapter.folderExists(file)) {
          hasConfigFile = true;
          adapter.markAsUsed(file);
          break;
        }
      }

      if (hasMarkoDep) {
        adapter.markPackageAsUsed(allDeps["@marko-js/marko"] ? "@marko-js/marko" : "marko");

        // Protect Marko ecosystem integrations if present in package.json
        // Do not treat a manifest entry as usage evidence.
      }

      // Check npm scripts running marko CLI or Marko Run
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("marko") || scriptContent.includes("marko-run"))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
          }
        }
      }

      if (hasConfigFile && !hasMarkoDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Marko configuration found but 'marko' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const fileName = path.basename(normalized);

      // 1. Mark .marko files as used (components/pages/layouts)
      if (normalized.endsWith(".marko")) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@marko-js/marko");
      }

      // 2. Mark Marko config files
      if (MARKO_CONFIG_FILES.includes(fileName)) {
        adapter.markAsUsed(fileId);
      }

      // 3. Mark Marko component directories & tags directory
      if (normalized.includes("/components/") || normalized.includes("/tags/")) {
        adapter.markAsUsed(fileId);
      }

      // 4. Mark Marko Run convention route files (+page.marko, +layout.marko, +handler.ts, +middleware.ts)
      if (fileName.startsWith("+") && (fileName.endsWith(".marko") || /\.[jt]sx?$/.test(fileName))) {
        adapter.markAsUsed(fileId);
      }

      // 5. Mark Marko adjacent component logic files (component.js, index.browser.js)
      if (
        fileName === "component.js" ||
        fileName === "component.ts" ||
        fileName === "index.browser.js" ||
        fileName === "index.browser.ts"
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node, fileId, adapter) => {
      // Analyze marko.json for taglib-imports and component tags
      const normalized = fileId.replace(/\\/g, "/");
      if (normalized.endsWith("marko.json") || normalized.endsWith("marko-taglib.json")) {
        if (t.isObjectProperty(node) || node.type === "Property") {
          const keyName = node.key?.name || node.key?.value;
          if (keyName === "tags" || keyName === "taglib-imports" || keyName === "taglib-lookup") {
            // Handle ArrayExpression -> "taglib-imports": ["./my-taglib.json", "some-package"]
            if (t.isArrayExpression(node.value)) {
              node.value.elements.forEach((el: any) => {
                if (t.isStringLiteral(el) || (el.type === "Literal" && typeof el.value === "string")) {
                  const val = el.value;
                  if (val.startsWith(".")) {
                    adapter.markAsUsed(val);
                  } else {
                    adapter.markPackageAsUsed(val);
                  }
                }
              });
            }
            // Handle ObjectExpression -> "tags": { "my-tag": "./tags/my-tag.marko" }
            else if (t.isObjectExpression(node.value)) {
              node.value.properties.forEach((prop: any) => {
                const val = prop.value;
                if (t.isStringLiteral(val) || (val.type === "Literal" && typeof val.value === "string")) {
                  const tagPath = val.value;
                  if (tagPath.startsWith(".")) {
                    adapter.markAsUsed(tagPath);
                  } else {
                    adapter.markPackageAsUsed(tagPath);
                  }
                }
              });
            }
          }
        }
      }
    }
  }
};

export default MarkoPlugin;