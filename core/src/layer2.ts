import type { AnalysisContext, Finding, ModuleRecord, Range } from "./types.js";
import { walkAst, isAstNode, getNodeType, getNodeProperty } from "./parser.js";

/**
 * Layer 2: Control Flow Graph (CFG) & Type-Based Abstract Interpretation
 * Detects unreachable code within functions and modules.
 */
export function analyzeLayer2(context: AnalysisContext): Finding[] {
  const findings: Finding[] = [];

  for (const module of context.modules.values()) {
    if (module.parseStatus === "fallback" || !module.ast) {
      continue;
    }

    const moduleFindings = analyzeModuleFlow(module, !context.options.layers.skipSmt);
    findings.push(...moduleFindings);
  }

  return findings;
}

function analyzeModuleFlow(module: ModuleRecord, detectImpossibleConditions = true): Finding[] {
  const findings: Finding[] = [];
  const ast = module.ast as any;

  // We look for function bodies, blocks, and conditional statements
  walkAst(ast, (rawNode) => {
    const node = rawNode as any;
    // 1. Detect unreachable statements after terminal nodes
    if (node.type === "BlockStatement" || node.type === "Program") {
      const body: any[] = Array.isArray(node.body) ? node.body : [];
      let terminalReached = false;
      let terminalNode: any = null;

      for (const stmt of body) {
        if (terminalReached) {
          // Hoisted declarations like function declarations are reachable even after a return
          if (stmt.type === "FunctionDeclaration") {
            continue;
          }

          const stmtLoc = stmt.loc as Range | undefined;
          findings.push({
            rule: "unreachable-statement",
            severity: "warning",
            confidence: "high",
            message: `Statement is unreachable because it follows a terminal statement (${terminalNode.type}).`,
            file: module.id,
            ...(stmtLoc !== undefined && { location: stmtLoc }),
            evidence: { terminalType: terminalNode.type },
          });
          // We only report the first unreachable statement to avoid noise
          break;
        }

        if (isTerminal(stmt)) {
          terminalReached = true;
          terminalNode = stmt;
        }
      }
    }

    // 2. Detect constant conditions. In skipSmt mode this branch is not
    // inspected at all; Layer 2 still continues with ordinary CFG analysis.
    if (detectImpossibleConditions && node.type === "IfStatement") {
      const condition = node.test;
      const result = evaluateStaticCondition(condition);
      if (result === false) {
        const consequentLoc = (node.consequent as any)?.loc as Range | undefined;
        findings.push({
          rule: "constant-condition",
          severity: "warning",
          confidence: "high",
          message: "Condition is always false; this branch will never execute.",
          file: module.id,
          ...(consequentLoc !== undefined && { location: consequentLoc }),
          evidence: { conditionValue: false },
        });
      } else if (result === true && node.alternate) {
        const alternateLoc = (node.alternate as any)?.loc as Range | undefined;
        findings.push({
          rule: "constant-condition",
          severity: "warning",
          confidence: "high",
          message: "Condition is always true; the 'else' branch will never execute.",
          file: module.id,
          ...(alternateLoc !== undefined && { location: alternateLoc }),
          evidence: { conditionValue: true },
        });
      }
    }

    if (
      detectImpossibleConditions &&
      (node.type === "WhileStatement" || node.type === "DoWhileStatement")
    ) {
      const result = evaluateStaticCondition(node.test);
      if (result === false && node.type === "WhileStatement") {
        const bodyLoc = (node.body as any)?.loc as Range | undefined;
        findings.push({
          rule: "constant-condition",
          severity: "warning",
          confidence: "high",
          message: "Loop condition is always false; the loop body will never execute.",
          file: module.id,
          ...(bodyLoc !== undefined && { location: bodyLoc }),
          evidence: { conditionValue: false },
        });
      }
    }

    // 3. Simple Contradictory Guards (e.g., x === 1 && x === 2)
    if (detectImpossibleConditions && node.type === "LogicalExpression" && node.operator === "&&") {
      if (isContradictory(node.left, node.right)) {
        const logicalLoc = node.loc as Range | undefined;
        findings.push({
          rule: "contradictory-guard",
          severity: "warning",
          confidence: "medium",
          message: "Logical expression contains a contradiction and will always be false.",
          file: module.id,
          ...(logicalLoc !== undefined && { location: logicalLoc }),
          evidence: {},
        });
      }
    }
    // 4. Type Narrowing Exhaustion (e.g., default branch with 'never' assignment)
    if (node.type === "SwitchCase" && !node.test) {
      // This is a 'default' case
      if (hasNeverUsage(node.consequent)) {
        const switchLoc = node.loc as Range | undefined;
        findings.push({
          rule: "unreachable-statement",
          severity: "info",
          confidence: "medium",
          message:
            "Default branch is marked as 'never' (exhaustive check), indicating it is dead code in a valid type system.",
          file: module.id,
          ...(switchLoc !== undefined && { location: switchLoc }),
          evidence: { type: "exhaustive-check" },
        });
      }
    }
  });

  return findings;
}

function hasNeverUsage(nodes: any[]): boolean {
  for (const node of nodes) {
    let found = false;
    walkAst(node, (rawChild) => {
      const child = rawChild as any;
      // Look for 'as never' or 'assertNever(val)'
      if (child.type === "TSAsExpression" && child.typeAnnotation?.type === "TSNeverKeyword") {
        found = true;
      }
      if (
        child.type === "CallExpression" &&
        child.callee?.type === "Identifier" &&
        child.callee?.name?.toLowerCase().includes("never")
      ) {
        found = true;
      }
      if (
        child.type === "VariableDeclarator" &&
        child.id?.typeAnnotation?.typeAnnotation?.type === "TSNeverKeyword"
      ) {
        found = true;
      }
    });
    if (found) return true;
  }
  return false;
}

function isTerminal(node: any): boolean {
  if (!node) return false;
  return (
    node.type === "ReturnStatement" ||
    node.type === "ThrowStatement" ||
    node.type === "BreakStatement" ||
    node.type === "ContinueStatement"
  );
}

function evaluateStaticCondition(node: any): boolean | undefined {
  if (!node) return undefined;

  // ESTree standard literal handling
  if (node.type === "Literal") {
    return Boolean(node.value);
  }

  if (node.type === "UnaryExpression" && node.operator === "!") {
    const val = evaluateStaticCondition(node.argument);
    return val === undefined ? undefined : !val;
  }

  // Basic literal comparisons: 1 === 2, "a" !== "b"
  if (node.type === "BinaryExpression") {
    const leftLit = getLiteralValue(node.left);
    const rightLit = getLiteralValue(node.right);

    if (leftLit !== undefined && rightLit !== undefined) {
      if (node.operator === "===" || node.operator === "==") return leftLit === rightLit;
      if (node.operator === "!==" || node.operator === "!=") return leftLit !== rightLit;
    }
  }

  return undefined;
}

function getLiteralValue(node: any): any {
  if (!node) return undefined;

  // ESTree / Yuku standard Literal check
  if (node.type === "Literal") {
    return node.value;
  }

  // Handle BigInt literals if present in ESTree (e.g., 1n)
  if (node.type === "BigIntLiteral") {
    return node.value;
  }

  return undefined;
}

function isContradictory(left: any, right: any): boolean {
  // Simple case: x === 1 && x === 2
  const leftExpr = parseSimpleEquality(left);
  const rightExpr = parseSimpleEquality(right);

  if (leftExpr && rightExpr && leftExpr.name === rightExpr.name) {
    if (
      leftExpr.operator === "===" &&
      rightExpr.operator === "===" &&
      leftExpr.value !== rightExpr.value
    ) {
      return true;
    }
  }
  return false;
}

function parseSimpleEquality(node: any): { name: string; operator: string; value: any } | null {
  if (node.type !== "BinaryExpression") return null;
  if (node.operator !== "===" && node.operator !== "==") return null;

  let identifier: string | null = null;
  let value: any = undefined;

  if (node.left.type === "Identifier") {
    identifier = node.left.name;
    value = getLiteralValue(node.right);
  } else if (node.right.type === "Identifier") {
    identifier = node.right.name;
    value = getLiteralValue(node.left);
  }

  if (identifier !== null && value !== undefined) {
    return { name: identifier, operator: node.operator, value };
  }
  return null;
}
