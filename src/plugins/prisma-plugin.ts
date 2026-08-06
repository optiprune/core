import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

/**
 * Prisma Plugin: Schützt das Schema und erkennt die Nutzung des Prisma Clients.
 */
export const PrismaPlugin: AnalyzerPlugin = {
  name: "prisma-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    // Erkennt Prisma, wenn eine schema.prisma Datei vorhanden ist
    try {
      const schema = await adapter.readFile('prisma/schema.prisma');
      return !!schema;
    } catch {
      return false;
    }
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      // Schützt die .prisma Schema-Dateien
      if (fileId.endsWith('.prisma')) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Erkennt Prisma Client Aufrufe: prisma.user.findMany()
      if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
        const obj = node.callee.object;
        if (t.isMemberExpression(obj) && (obj.object as any).name === 'prisma') {
          // Markiert das entsprechende Model (z.B. 'user') als verwendet
          adapter.markAsUsed(fileId, (obj.property as any).name);
        }
      }
    }
  }
};

export default PrismaPlugin;
