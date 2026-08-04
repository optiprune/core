import type { AnalysisContext, Finding } from "./types.js";
import { walkAst } from "./parser.js";

/**
 * Layer 5: Schema Alignment
 * Protects public interfaces and contracts (Zod, Prisma, GraphQL, OpenAPI) from being falsely marked as dead code.
 */
export async function analyzeLayer5(context: AnalysisContext): Promise<Finding[]> {
  const findings: Finding[] = [];
  const externallyDefinedContracts = new Set<string>(context.options.externalContracts || []);

  const PROTECTED_DECORATORS = new Set([
    'Controller', 'Injectable', 'Module', 'Resolver', 'Directive',
    'ObjectType', 'InputType', 'Field', 'Query', 'Mutation', 'Subscription',
    'Entity', 'Table', 'Column', 'PrimaryGeneratedColumn', 'OneToMany', 'ManyToOne', 'ManyToMany', 'JoinColumn',
    'Get', 'Post', 'Put', 'Delete', 'Patch', 'Options', 'Head', 'All'
  ]);

  // Phase 1: Identify symbols explicitly provided as external contracts via options
  // These are already added to `externallyDefinedContracts` at initialization.

  // Phase 2: Decorator & Framework Metadata Reader
  for (const module of context.modules.values()) {
    if (!module.ast) continue;

    walkAst(module.ast, (rawNode) => {
      const node = rawNode as any;

      // 1. Framework Decorators (NestJS, TypeORM, MikroORM, TypeGraphQL)
      const decorators: any[] = [
        ...(Array.isArray(node.decorators) ? node.decorators : []),
        ...(Array.isArray(node.modifiers)
          ? node.modifiers.filter((m: any) => m.type === 'Decorator')
          : []),
      ];

      if (decorators.length > 0) {
        for (const decorator of decorators) {
          let decoratorName = "";
          const expr = decorator.expression as any;
          if (expr?.type === 'CallExpression' && expr.callee?.type === 'Identifier') {
            decoratorName = expr.callee.name;
          } else if (expr?.type === 'Identifier') {
            decoratorName = expr.name;
          }

          if (PROTECTED_DECORATORS.has(decoratorName)) {
            let targetNode = node;
            if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') && node.declaration) {
              targetNode = node.declaration;
            }

            if ((targetNode.type === 'ClassDeclaration' || targetNode.type === 'FunctionDeclaration') && targetNode.id?.name) {
              externallyDefinedContracts.add(targetNode.id.name);
            } else if ((targetNode.type === 'ClassMethod' || targetNode.type === 'ClassProperty') && targetNode.key?.type === 'Identifier') {
              externallyDefinedContracts.add(targetNode.key.name);
            } else if (targetNode.type === 'VariableDeclaration') {
              (targetNode.declarations as any[]).forEach((decl: any) => {
                if (decl.id?.type === 'Identifier') externallyDefinedContracts.add(decl.id.name);
              });
            }
          }
        }
      }

      // 2. JSDoc Annotations (@public, @used, optiprune-ignore)
      if (Array.isArray(node.leadingComments)) {
        const isPublic = (node.leadingComments as any[]).some((comment: any) =>
          comment.value.includes("@public") ||
          comment.value.includes("@used") ||
          comment.value.includes("optiprune-ignore")
        );

        if (isPublic) {
          if (node.type === 'VariableDeclaration') {
            (node.declarations as any[]).forEach((decl: any) => {
              if (decl.id?.type === 'Identifier') externallyDefinedContracts.add(decl.id.name);
            });
          } else if (
            (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') &&
            node.id?.name
          ) {
            externallyDefinedContracts.add(node.id.name);
          } else if (node.type === 'ExportNamedDeclaration' && node.declaration) {
            const decl = node.declaration as any;
            if (decl.type === 'VariableDeclaration') {
              (decl.declarations as any[]).forEach((d: any) => {
                if (d.id?.type === 'Identifier') externallyDefinedContracts.add(d.id.name);
              });
            } else if (
              (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') &&
              decl.id?.name
            ) {
              externallyDefinedContracts.add(decl.id.name);
            }
          }
        }
      }

      // 3. Schema & Validation Framework Naming Pattern Matching
      let varDeclarations: any[] = [];
      if (node.type === 'VariableDeclaration') {
        varDeclarations = node.declarations || [];
      } else if (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'VariableDeclaration') {
        varDeclarations = node.declaration.declarations || [];
      }

      for (const decl of varDeclarations) {
        if (decl.id?.type === 'Identifier') {
          const varName = decl.id.name;
          const init = decl.init;

          const isZodCall =
            init?.type === 'CallExpression' &&
            ((init.callee?.type === 'MemberExpression' &&
              (init.callee.object?.name === 'z' || init.callee.object?.name === 'zod')) ||
             (init.callee?.type === 'Identifier' &&
              (init.callee.name === 'z' || init.callee.name.startsWith('zod'))));

          if (isZodCall || varName.endsWith('Schema')) {
            externallyDefinedContracts.add(varName);
          }
        }
      }

      // Check class and function declarations ending in Schema (e.g., export class UserSchema)
      let targetNameNode: any = null;
      if (node.type === 'ClassDeclaration' || node.type === 'FunctionDeclaration') {
        targetNameNode = node;
      } else if (
        node.type === 'ExportNamedDeclaration' &&
        node.declaration &&
        (node.declaration.type === 'ClassDeclaration' || node.declaration.type === 'FunctionDeclaration')
      ) {
        targetNameNode = node.declaration;
      }

      if (targetNameNode?.id?.name && targetNameNode.id.name.endsWith('Schema')) {
        externallyDefinedContracts.add(targetNameNode.id.name);
      }
    });
  }

  // Phase 3: Apply Contract Guard Marking to ExportRecords
  for (const module of context.modules.values()) {
    if (module.exports) {
      for (const exportRecord of module.exports) {
        if (
          (exportRecord.name && externallyDefinedContracts.has(exportRecord.name)) ||
          (exportRecord.exportedAs && externallyDefinedContracts.has(exportRecord.exportedAs))
        ) {
          exportRecord.isExternalContract = true;
        }
      }
    }
  }

  return findings;
}