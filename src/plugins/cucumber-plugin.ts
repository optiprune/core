import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized Cucumber configuration files
 */
const CUCUMBER_CONFIG_FILES = [
  "cucumber.js",
  "cucumber.cjs",
  "cucumber.mjs",
  "cucumber.json",
  "cucumber.yaml",
  "cucumber.yml",
  ".cucumberrc",
  ".cucumberrc.json"
];

const CUCUMBER_PACKAGES = [
  "@cucumber/cucumber",
  "cucumber",
  "@cucumber/gherkin",
  "@cucumber/messages",
  "@cucumber/html-formatter",
  "@cucumber/pretty-formatter",
  "cucumber-html-reporter",
  "cucumber-console-formatter"
];

/**
 * Helper to process Cucumber configuration objects and extract formatters / requires
 */
function processCucumberConfig(config: Record<string, any>, adapter: any): void {
  if (!config || typeof config !== "object") return;

  // Process formatters (e.g., format: ["@cucumber/pretty-formatter", "json:reports/cucumber.json"])
  const formats = config.format || config.formats;
  if (formats) {
    const formatList = Array.isArray(formats) ? formats : [formats];
    for (const fmt of formatList) {
      if (typeof fmt === "string") {
        const formatterName = fmt.split(":")[0]?.trim();
        if (formatterName && (formatterName.startsWith("@") || formatterName.includes("formatter") || formatterName.includes("reporter"))) {
          adapter.markPackageAsUsed(formatterName);
        }
      }
    }
  }

  // Process require / import arrays (e.g., require: ["features/step_definitions/**/*.js", "ts-node/register"])
  const requires = config.require || config.import;
  if (requires) {
    const requireList = Array.isArray(requires) ? requires : [requires];
    for (const req of requireList) {
      if (typeof req === "string" && !req.includes("*")) {
        // If it's a package reference (e.g. "ts-node/register" or "tsconfig-paths/register")
        if (!req.startsWith(".") && !req.startsWith("/")) {
          const pkgName = req.startsWith("@") ? req.split("/").slice(0, 2).join("/") : req.split("/")[0];
          if (pkgName) adapter.markPackageAsUsed(pkgName);
        } else {
          adapter.markAsUsed(req);
        }
      }
    }
  }
}

export const CucumberPlugin: AnalyzerPlugin = {
  name: "cucumber-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated Cucumber config files or features directory
    for (const configFile of CUCUMBER_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    if (await adapter.folderExists("features")) return true;

    // 2. Check package.json for inline config, dependencies, or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (pkg.cucumber) return true;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (CUCUMBER_PACKAGES.some((p) => p in allDeps)) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (/\bcucumber-js\b/.test(s) || /\bcucumber\b/.test(s))
          )
        ) {
          return true;
        }
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");

      // 1. Protect dedicated configuration files and features folder
      for (const configFile of CUCUMBER_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      if (await adapter.folderExists("features")) {
        adapter.markAsUsed("features");
      }

      if (pkg) {
        // 2. Protect Cucumber core and plugin packages in package.json
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies
        };

        for (const depName of Object.keys(allDeps)) {
          if (
            depName === "cucumber" ||
            depName.startsWith("@cucumber/") ||
            depName.startsWith("cucumber-")
          ) {
            adapter.markPackageAsUsed(depName);
          }
        }

        // 3. Process inline package.json#cucumber configuration block
        if (pkg.cucumber) {
          adapter.markAsUsed("package.json", "cucumber");
          processCucumberConfig(pkg.cucumber, adapter);
        }

        // 4. Mark scripts executing cucumber CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\bcucumber-js\b/.test(scriptContent) || /\bcucumber\b/.test(scriptContent))
            ) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }

      // 5. Parse standalone JSON config files if present
      const jsonConfigFile =
        (await adapter.folderExists("cucumber.json"))
          ? "cucumber.json"
          : (await adapter.folderExists(".cucumberrc.json"))
          ? ".cucumberrc.json"
          : (await adapter.folderExists(".cucumberrc"))
          ? ".cucumberrc"
          : null;

      if (jsonConfigFile) {
        const configData = await adapter.readJson(jsonConfigFile);
        if (configData) {
          processCucumberConfig(configData, adapter);
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (CUCUMBER_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }

      // Mark Gherkin feature files, step definitions, and support files
      if (
        normalized.endsWith(".feature") ||
        normalized.includes("/step_definitions/") ||
        normalized.includes("/steps/") ||
        normalized.includes("/support/")
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Inspect JS configuration files (cucumber.js, cucumber.cjs, etc.)
      if (
        basename.startsWith("cucumber.") &&
        (basename.endsWith(".js") || basename.endsWith(".cjs") || basename.endsWith(".mjs"))
      ) {
        // Mark ES module default export / CommonJS module.exports
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }

        if (
          t.isAssignmentExpression(node) &&
          t.isMemberExpression(node.left) &&
          t.isIdentifier(node.left.object) &&
          node.left.object.name === "module" &&
          t.isIdentifier(node.left.property) &&
          node.left.property.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
        }

        // Inspect AST for "format", "require", or "import" options inside config exports
        if (t.isObjectProperty(node) && t.isIdentifier(node.key)) {
          const keyName = node.key.name;

          if (keyName === "format" || keyName === "import" || keyName === "require") {
            if (t.isStringLiteral(node.value)) {
              const val = node.value.value;
              if (val.startsWith("@") || val.includes("formatter")) {
                const pkgName = val.split(":")[0];
                if (pkgName) {
                adapter.markPackageAsUsed(pkgName);
                }
              }
            } else if (t.isArrayExpression(node.value)) {
              for (const element of node.value.elements) {
                if (t.isStringLiteral(element)) {
                  const val = element.value;
                  if (val.startsWith("@") || val.includes("formatter")) {
                    const pkgName = val.split(":")[0];
                    if (pkgName) {
                      adapter.markPackageAsUsed(pkgName);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
};

export default CucumberPlugin;