import { AnalyzerPlugin } from "../types.js";

const STORY_FILE_REGEX = /\.(stories|story)\.[jt]sx?$/;
const STORYBOOK_DIR_REGEX = /\.storybook\//;

export const StorybookPlugin: AnalyzerPlugin = {
  name: "storybook-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
    return Object.keys(deps).some((dep) => dep.includes("storybook"));
  },

  lifecycle: {
    onFileStart: (fileId, adapter) => {
      // Story files and .storybook configs are implicit entry points
      if (STORY_FILE_REGEX.test(fileId) || STORYBOOK_DIR_REGEX.test(fileId)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node, fileId, adapter) => {
      // Story files use default export (meta) and named exports (stories)
      if (!STORY_FILE_REGEX.test(fileId)) return;

      if (node.type === "ExportDefaultDeclaration") {
        adapter.markAsUsed(fileId, "default");
      }

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