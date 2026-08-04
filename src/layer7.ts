import type { AnalysisContext, Finding, ModuleRecord, Range, DependencyEdge } from "./types.js";
import { walkAst } from "./parser.js";
import { SemanticGraph } from "./semantic-graph.js";
import path from "pathe";
import fs from "node:fs";

export interface Layer7Result {
  layer: 7;
  implicitEdges: ImplicitEdge[];
  resolvedDynamicImports: ResolvedDynamicImport[];
}

export interface ImplicitEdge {
  id: string;
  type: 'DI_INJECTION' | 'EVENT_CONTRACT';
  provider?: {
    file: string;
    symbol: string;
    token: string;
  };
  consumer: {
    file: string;
    symbol: string;
    handler?: string;
  };
  topic?: string;
  status: 'ACTIVE' | 'DEAD_ORPHANED_CONSUMER';
}

export interface ResolvedDynamicImport {
  sourceFile: string;
  template: string;
  resolvedFiles: string[];
}

export async function analyzeLayer7(context: AnalysisContext): Promise<Finding[]> {
  const findings: Finding[] = [];
  const implicitEdges: ImplicitEdge[] = [];
  const resolvedDynamicImports: ResolvedDynamicImport[] = [];

  // 1. DI Topology Engine
  const diEdges = analyzeDITopology(context);
  implicitEdges.push(...diEdges);

  // 2. Cross-Repository / Event Bus Contract Engine
  const eventEdges = analyzeEventContracts(context);
  implicitEdges.push(...eventEdges);

  // 3. Dynamic Specifier & Template Literal Engine
  const dynamicResults = await analyzeDynamicSpecifiers(context);
  resolvedDynamicImports.push(...dynamicResults);

  // Merge results into the main graph and findings
  applyLayer7Results(context, implicitEdges, resolvedDynamicImports, findings);

  return findings;
}

/**
 * Sub-Engine A: Dependency Injection Topology Engine
 */
function analyzeDITopology(context: AnalysisContext): ImplicitEdge[] {
  const providers = new Map<string, { file: string; symbol: string }>();
  const consumers: Array<{ file: string; symbol: string; token: string }> = [];
  const edges: ImplicitEdge[] = [];

  for (const module of context.modules.values()) {
    if (!module.ast) continue;

    walkAst(module.ast, (rawNode) => {
      const node = rawNode as any;

      // Extract classNode whether it's standalone or exported
      const classNode =
        node.type === "ClassDeclaration"
          ? node
          : node.type === "ExportNamedDeclaration" && node.declaration?.type === "ClassDeclaration"
          ? node.declaration
          : null;

      if (classNode) {
        // Gather decorators from both outer Export declaration AND inner Class declaration
        const decorators = [
          ...getDecorators(node),
          ...getDecorators(classNode),
        ];

        const isProvider = decorators.some((d) =>
          ["Injectable", "Module", "Service"].includes(d.name)
        );
        const className = classNode.id?.name;

        if (isProvider && className) {
          providers.set(className, { file: module.id, symbol: className });
        }

        // Check constructor parameters for @Inject('TOKEN')
        const constructor = classNode.body?.body?.find(
          (m: any) => m.kind === "constructor"
        );
        if (constructor) {
          const params = constructor.params || constructor.value?.params || [];
          for (const rawParam of params) {
            const param =
              rawParam.type === "TSParameterProperty" ? rawParam.parameter : rawParam;
            const paramDecorators = [
              ...getDecorators(rawParam),
              ...getDecorators(param),
            ];

            const injectDecorator = paramDecorators.find((d) => d.name === "Inject");
            if (injectDecorator && injectDecorator.args.length > 0) {
              const token = injectDecorator.args[0];
              if (typeof token === "string" && className) {
                consumers.push({ file: module.id, symbol: className, token });
              }
            }
          }
        }
      }

      // container.bind('TOKEN').to(Service)
      if (node.type === "CallExpression" && node.callee.type === "MemberExpression") {
        if (node.callee.property.name === "bind" && node.arguments.length > 0) {
          const token = getLiteralValue(node.arguments[0]);
          if (token) {
            // Simplified chain traversal
          }
        }
      }
    });
  }

  // Matching logic
  for (const consumer of consumers) {
    const provider = providers.get(consumer.token);
    if (provider) {
      edges.push({
        id: `di-${consumer.file}-${consumer.token}`,
        type: "DI_INJECTION",
        provider: { ...provider, token: consumer.token },
        consumer: { file: consumer.file, symbol: consumer.symbol },
        status: "ACTIVE",
      });
    }
  }

  return edges;
}

/**
 * Sub-Engine B: Cross-Repository / Event Bus Contract Engine
 */
function analyzeEventContracts(context: AnalysisContext): ImplicitEdge[] {
  const producers: Array<{ file: string; topic: string }> = [];
  const consumers: Array<{ file: string; symbol: string; handler: string; topic: string }> = [];
  const edges: ImplicitEdge[] = [];

  for (const module of context.modules.values()) {
    if (!module.ast) continue;

    walkAst(module.ast, (rawNode) => {
      const node = rawNode as any;

      // Consumer: @EventPattern('topic'), @MessagePattern('topic')
      if (node.type === 'ClassMethod' || node.type === 'MethodDefinition') {
        const decorators = getDecorators(node);
        const eventDecorator = decorators.find(d => ['EventPattern', 'MessagePattern', 'OnEvent'].includes(d.name));
        if (eventDecorator && eventDecorator.args.length > 0) {
          const topic = eventDecorator.args[0];
          if (typeof topic === 'string') {
            consumers.push({
              file: module.id,
              symbol: 'unknown',
              handler: node.key.name,
              topic
            });
          }
        }
      }

      // Producer: emitter.emit('topic'), client.send('topic')
      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
        if (['emit', 'send', 'publish'].includes(node.callee.property.name) && node.arguments.length > 0) {
          const topic = getLiteralValue(node.arguments[0]);
          if (topic) {
            producers.push({ file: module.id, topic });
          }
        }
      }
    });
  }

  // Match Producers to Consumers
  const producerTopics = new Set(producers.map(p => p.topic));
  
  for (const consumer of consumers) {
    const isActive = producerTopics.has(consumer.topic);
    edges.push({
      id: `event-${consumer.file}-${consumer.topic}`,
      type: 'EVENT_CONTRACT',
      topic: consumer.topic,
      consumer: { file: consumer.file, symbol: consumer.symbol, handler: consumer.handler },
      status: isActive ? 'ACTIVE' : 'DEAD_ORPHANED_CONSUMER'
    });
  }

  return edges;
}

/**
 * Sub-Engine C: Dynamic Specifier & Template Literal Engine
 */
async function analyzeDynamicSpecifiers(context: AnalysisContext): Promise<ResolvedDynamicImport[]> {
  const results: ResolvedDynamicImport[] = [];
  const allFiles = Array.from(context.modules.keys());

  for (const module of context.modules.values()) {
    for (const edge of module.edges) {
      if (edge.kind === 'dynamic-pattern' && edge.dynamicPattern) {
        const { prefix, suffix } = edge.dynamicPattern;
        
        // Bounded glob search over mapped modules
        const resolvedFiles = allFiles.filter(f => {
          const relative = path.relative(path.dirname(module.id), f);
          const normalizedRelative = relative.startsWith('.') ? relative : './' + relative;
          return normalizedRelative.startsWith(prefix) && normalizedRelative.endsWith(suffix);
        });

        if (resolvedFiles.length > 0) {
          results.push({
            sourceFile: module.id,
            template: edge.rawSpecifier,
            resolvedFiles
          });
        }
      }
    }
  }

  return results;
}

/**
 * Merges Layer 7 results into the AnalysisContext
 */
function applyLayer7Results(
  context: AnalysisContext,
  implicitEdges: ImplicitEdge[],
  resolvedDynamicImports: ResolvedDynamicImport[],
  findings: Finding[]
) {
  // 1. Add implicit edges to reachability
  for (const edge of implicitEdges) {
    if (edge.status === 'ACTIVE') {
      if (edge.type === 'DI_INJECTION' && edge.provider) {
        if (context.reachable.has(edge.consumer.file)) {
          context.reachable.add(edge.provider.file);
          context.usedExports.add(`${edge.provider.file}:${edge.provider.symbol}`);
        }
      } else if (edge.type === 'EVENT_CONTRACT') {
        context.reachable.add(edge.consumer.file);
        context.usedExports.add(`${edge.consumer.file}:${edge.consumer.handler}`);
      }
    } else if (edge.status === 'DEAD_ORPHANED_CONSUMER') {
      findings.push({
        rule: "protected-contract",
        severity: "warning",
        confidence: "high",
        message: `Orphaned Event Consumer: No producers found for topic '${edge.topic}'.`,
        file: edge.consumer.file,
        evidence: { topic: edge.topic, handler: edge.consumer.handler }
      });
    }
  }

  // 2. Resolve dynamic imports
  for (const resolved of resolvedDynamicImports) {
    if (context.reachable.has(resolved.sourceFile)) {
      for (const file of resolved.resolvedFiles) {
        context.reachable.add(file);
      }
    }
  }
}

// --- Utilities ---

function getDecorators(node: any): Array<{ name: string; args: any[] }> {
  if (!node) return [];

  const decorators: any[] = [
    ...(Array.isArray(node?.decorators) ? node.decorators : []),
    ...(Array.isArray(node?.modifiers)
      ? node.modifiers.filter((m: any) => m.type === 'Decorator' || m.kind === 'Decorator')
      : []),
  ];

  return decorators.map(d => {
    const expr = d.expression || d;
    if (expr.type === 'CallExpression') {
      let name = 'unknown';
      if (expr.callee.type === 'Identifier') {
        name = expr.callee.name;
      } else if (expr.callee.type === 'MemberExpression' && expr.callee.property.type === 'Identifier') {
        name = expr.callee.property.name;
      }
      return {
        name,
        args: expr.arguments.map((a: any) => getLiteralOrIdentifierValue(a))
      };
    }
    return {
      name: expr.name || (expr.type === 'Identifier' ? expr.name : 'unknown'),
      args: []
    };
  });
}

function getLiteralOrIdentifierValue(node: any): any {
  if (!node) return undefined;
  if (node.type === 'Identifier') return node.name;
  return getLiteralValue(node);
}

function getLiteralValue(node: any): any {
  if (!node) return undefined;
  // ESTree Literal (Yuku)
  if (node.type === 'Literal') return node.value;
  // Babel Compatibility
  if (node.type === 'StringLiteral' || node.type === 'NumericLiteral' || node.type === 'BooleanLiteral') return node.value;
  if (node.type === 'TemplateLiteral') {
    if (node.expressions.length === 0) return node.quasis[0].value.cooked;
  }
  return undefined;
}