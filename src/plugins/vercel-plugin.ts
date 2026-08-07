import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

const VERCEL_CONFIG_FILES = ["vercel.json", "now.json"];

export const VercelPlugin: AnalyzerPlugin = {
  name: "vercel-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg && (pkg.devDependencies?.["vercel"] || pkg.dependencies?.["vercel"])) {
      return true;
    }
    for (const file of VERCEL_CONFIG_FILES) {
      if ((await adapter.readFile(file)) !== null) return true;
    }
    // Check for vercel-specific directories
    const hasApi = (await adapter.readFile("api/index.js")) !== null || (await adapter.readFile("api/index.ts")) !== null;
    return hasApi;
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      const basename = path.basename(fileId);
      if (VERCEL_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
      // Vercel Serverless Functions
      if (fileId.includes("/api/")) {
        adapter.markAsUsed(fileId);
      }
      // Vercel OG Images
      if (fileId.includes("opengraph-image") || fileId.includes("twitter-image")) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Detect @vercel/og usage
      if (node.type === "ImportDeclaration" && node.source.value === "@vercel/og") {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default VercelPlugin;
