import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

// Nitro: Versteht server/api und server/routes
export const NitroPlugin: AnalyzerPlugin = {
  name: "nitro-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    return !!(pkg?.dependencies?.['nitropack'] || pkg?.devDependencies?.['nitropack']);
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      if (fileId.includes('server/api/') || fileId.includes('server/routes/') || fileId.includes('server/middleware/')) {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

// Prisma: Schützt das Schema und erkennt Client-Nutzung
export const PrismaPlugin: AnalyzerPlugin = {
  name: "prisma-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    return !!(await adapter.readFile('prisma/schema.prisma'));
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      if (fileId.endsWith('.prisma')) adapter.markAsUsed(fileId);
    },
    onASTNode: (node, fileId, adapter) => {
      // Erkennt Prisma Client Aufrufe: prisma.user.findMany()
      if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
        const obj = node.callee.object;
        if (t.isMemberExpression(obj) && (obj.object as any).name === 'prisma') {
          adapter.markAsUsed(fileId, (obj.property as any).name);
        }
      }
    }
  }
};