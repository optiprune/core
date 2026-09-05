import type { AnalyzerPlugin, PluginAdapter } from "../types.js";
import { packageIsDeclared } from "./package-plugin-utils.js";

const PACKAGE = "syncpack";
const CONFIG_PATTERNS = ["syncpack.config.js", "syncpack.config.cjs", "syncpack.config.json"];

async function findConfigFiles(adapter: PluginAdapter): Promise<string[]> {
  const exact = CONFIG_PATTERNS.filter(
    (pattern) => !pattern.includes("*") && !pattern.includes("?"),
  );
  const glob = CONFIG_PATTERNS.filter((pattern) => pattern.includes("*") || pattern.includes("?"));
  const files = new Set<string>();
  for (const file of await adapter.findFiles(exact)) files.add(file);
  for (const file of await adapter.findFilesByGlob(glob)) files.add(file);
  return [...files];
}

export const SyncpackPlugin: AnalyzerPlugin = {
  name: `${PACKAGE}-plugin`,
  version: "1.2.0",
  async detect(adapter) {
    const pkg = await adapter.readJson("package.json");
    return packageIsDeclared(pkg, PACKAGE) || (await findConfigFiles(adapter)).length > 0;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const configFiles = await findConfigFiles(adapter);
      for (const file of configFiles) {
        // Tool configuration is consumed externally; retain it without treating it as an executable entry point.
        adapter.markConfigFileAsUsed(file);
        adapter.markPackageAsUsed(PACKAGE);
      }
      if (pkg?.scripts && typeof pkg.scripts === "object") {
        for (const [scriptName, command] of Object.entries(pkg.scripts)) {
          if (typeof command === "string" && command.includes(PACKAGE)) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed(PACKAGE);
          }
        }
      }
    },
    onASTNode: (node, fileId, adapter) => {
      if (
        node?.type === "ImportDeclaration" ||
        node?.type === "ExportNamedDeclaration" ||
        node?.type === "ExportAllDeclaration"
      ) {
        const source = node.source?.value;
        if (
          typeof source === "string" &&
          (source === PACKAGE || source.startsWith(`${PACKAGE}/`))
        ) {
          adapter.markPackageAsUsed(PACKAGE);
          adapter.markAsUsed(fileId);
        }
      }
      if (
        node?.type === "CallExpression" &&
        (node.callee?.name === "require" || node.callee?.name === "import")
      ) {
        const source = node.arguments?.[0]?.value;
        if (typeof source === "string" && (source === PACKAGE || source.startsWith(`${PACKAGE}/`)))
          adapter.markPackageAsUsed(PACKAGE);
      }
    },
  },
};

export default SyncpackPlugin;
