import { AnalyzerPlugin } from "../types.js";

/**
 * Interner Speicher für das Tracking von Objekt-Eigenschaften.
 * Wir definieren ihn außerhalb des Plugin-Objekts, um TypeScript-Fehler zu vermeiden.
 */
const state = {
  definitions: new Map<string, { fileId: string, members: Map<string, any>, loc: any }>(),
  usages: new Set<string>()
};

/**
 * Object Member Plugin
 * Schließt die Lücke im Deep Member Tracking für exportierte Objekt-Literale.
 */
export const ObjectMemberPlugin: AnalyzerPlugin = {
  name: "object-member-plugin",
  version: "1.0.0",

  lifecycle: {
    /**
     * Scannt den AST nach Definitionen und Nutzungen.
     */
    onASTNode: (node: any, fileId: string) => {
      // 1. Erfassen: Exportierte Objekt-Eigenschaften finden
      if (node.type === "ExportNamedDeclaration" && node.declaration?.type === "VariableDeclaration") {
        for (const decl of node.declaration.declarations) {
          if (decl.id.type === "Identifier" && decl.init?.type === "ObjectExpression") {
            const objName = decl.id.name;
            const members = new Map<string, any>();
            
            for (const prop of decl.init.properties) {
              if (prop.type === "ObjectProperty" && prop.key.type === "Identifier") {
                members.set(prop.key.name, prop.key.loc);
              }
            }
            
            if (members.size > 0) {
              state.definitions.set(objName, { 
                fileId, 
                members, 
                loc: decl.id.loc || node.loc 
              });
            }
          }
        }
      }

      // 2. Tracking: Zugriff auf Eigenschaften registrieren (z.B. config.usedKey)
      if (node.type === "MemberExpression" && node.property.type === "Identifier") {
        if (node.object.type === "Identifier") {
          state.usages.add(`${node.object.name}.${node.property.name}`);
        }
      }
    },

    /**
     * Nach der Analyse: Abgleich der gefundenen Nutzungen mit den Definitionen.
     */
    onAnalysisComplete: async (adapter: any) => {
      for (const [objName, def] of state.definitions.entries()) {
        for (const [memberName, memberLoc] of def.members.entries()) {
          const usageKey = `${objName}.${memberName}`;
          
          if (!state.usages.has(usageKey)) {
            // Wir nutzen 'as any', um das 'rule' Feld trotz Omit-Einschränkung zu setzen
            adapter.emitFinding({
              rule: "unused-member",
              severity: "warning",
              confidence: "high",
              message: `Property '${memberName}' in exported object '${objName}' is never referenced.`,
              file: def.fileId,
              location: memberLoc || def.loc,
              evidence: { 
                exportName: objName, 
                memberName: memberName 
              }
            } as any);
          }
        }
      }
      
      // State für den nächsten Durchlauf leeren
      state.definitions.clear();
      state.usages.clear();
    }
  }
};

export default ObjectMemberPlugin;
