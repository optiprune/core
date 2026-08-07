import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

/**
 * Prisma Plugin: Schützt das Schema und erkennt die Nutzung des Prisma Clients.
 */
export const PrismaPlugin: AnalyzerPlugin = {
  name: "prisma-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    if (pkg?.devDependencies?.['prisma'] || pkg?.dependencies?.['@prisma/client']) {
      return true;
    }
    // Erkennt Prisma, wenn eine schema.prisma Datei vorhanden ist
    try {
      const schema = await adapter.readFile('prisma/schema.prisma');
      return !!schema;
    } catch {
      return false;
    }
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson('package.json');
      const hasPrismaDep = pkg ? !!(pkg.dependencies?.['@prisma/client'] || pkg.devDependencies?.['prisma']) : false;
      
      const schema = await adapter.readFile('prisma/schema.prisma');
      if (schema !== null && !hasPrismaDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Prisma schema found but 'prisma' or '@prisma/client' is not listed in package.json.",
          evidence: { hasSchema: true }
        });
      }
    },
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
