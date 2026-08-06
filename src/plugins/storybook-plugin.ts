import { AnalyzerPlugin } from "../types.js";

const STORY_FILE_REGEX = /\.(stories|story)\.[jt]sx?$/;
const STORYBOOK_DIR_REGEX = /\.storybook\//;

export const StorybookPlugin: AnalyzerPlugin = {
  name: "storybook-plugin",
  version: "1.0.0",

  /**
   * Erkennt Storybook anhand der Abhängigkeiten in der package.json.
   */
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (!pkg) return false;

    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return Object.keys(deps).some((dep) => dep.includes("storybook"));
  },

  lifecycle: {
    /**
     * Markiert Story-Dateien und den .storybook-Ordner als implizite Einstiegspunkte.
     */
    onFileStart: (fileId, adapter) => {
      if (STORY_FILE_REGEX.test(fileId) || STORYBOOK_DIR_REGEX.test(fileId)) {
        adapter.markAsUsed(fileId);
      }
    },

    /**
     * Analysiert die AST-Knoten von Story-Dateien, um sicherzustellen, 
     * dass sowohl der Default-Export (Meta) als auch die benannten Stories (Named Exports) 
     * als "verwendet" markiert werden.
     */
    onASTNode: (node, fileId, adapter) => {
      if (!STORY_FILE_REGEX.test(fileId)) return;

      // Schützt 'export default { ... }'
      if (node.type === "ExportDefaultDeclaration") {
        adapter.markAsUsed(fileId, "default");
      }

      // Schützt benannte Story-Exporte wie 'export const Primary = ...'
      if (node.type === "ExportNamedDeclaration" && node.declaration) {
        const decl = node.declaration;
        if (decl.type === "VariableDeclaration") {
          for (const d of decl.declarations) {
            if (d.id?.type === "Identifier") {
              adapter.markAsUsed(fileId, d.id.name);
            }
          }
        }
      }
    },
  },
};

export default StorybookPlugin;
