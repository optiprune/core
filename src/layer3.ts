import type { AnalysisContext, Finding, ModuleRecord } from "./types.js";
import { walkAst } from "./parser.js";
import { instrumentCode } from "./instrument.js";

/**
 * Layer 3: SMT Constraint Solver
 * Uses Z3 to prove path unreachability in complex logical branches.
 */
export async function analyzeLayer3(context: AnalysisContext): Promise<Finding[]> {
  const findings: Finding[] = [];
  
  // Quick scan to see if we even need Z3
  let needsZ3 = false;
  for (const module of context.modules.values()) {
    if (module.parseStatus === "parsed" && module.ast) {
      walkAst(module.ast, (node) => {
        if (node.type === "IfStatement" || node.type === "LogicalExpression") {
          needsZ3 = true;
          return true; // Stop walking this AST
        }
      });
      if (needsZ3) break;
    }
  }

  if (!needsZ3) {
    return [];
  }

  let z3: any;
  try {
    const { init } = await import("z3-solver");
    const { Context } = await init();
    z3 = Context('main');
  } catch (e) {
    console.warn(`[Layer 3] Failed to initialize Z3 solver: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }

  for (const module of context.modules.values()) {
    if (module.parseStatus === "fallback" || !module.ast) {
      continue;
    }

    const moduleFindings = await analyzeModuleLogic(module, z3, context);
    findings.push(...moduleFindings);
  }

  return findings;
}

async function analyzeModuleLogic(module: ModuleRecord, z3: any, context: AnalysisContext): Promise<Finding[]> {
  const findings: Finding[] = [];
  const ast = module.ast as any;

  const functionNodes: any[] = [];
  walkAst(ast, (node) => {
    if (node.type === "FunctionDeclaration" || node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") {
      functionNodes.push(node);
    }
  });

  for (const node of functionNodes) {
      const body = node.body;
      if (body.type === "BlockStatement") {
        const solver = new z3.Solver();
        const pathFindings = await analyzeFunctionPaths(body, z3, solver, module, context);
        findings.push(...pathFindings);
      }
  }

  return findings;
}

async function analyzeFunctionPaths(block: any, z3: any, solver: any, module: ModuleRecord, context: AnalysisContext): Promise<Finding[]> {
  const findings: Finding[] = [];
  const body = block.body || [];

  for (const stmt of body) {
    if (stmt.type === "IfStatement") {
      await analyzeIfStatement(stmt, z3, solver, module, findings, [], context);
    }
  }

  return findings;
}

async function extractModel(solver: any): Promise<Record<string, any>> {
  const model = solver.model();
  const inputs: Record<string, any> = {};
  for (const decl of model.decls()) {
    const val = model.getConst(decl);
    if (val) {
      const strVal = val.toString();
      if (!isNaN(Number(strVal))) {
        inputs[decl.name().toString()] = Number(strVal);
      } else {
        inputs[decl.name().toString()] = strVal;
      }
    }
  }
  return inputs;
}

async function analyzeIfStatement(
  node: any,
  z3: any,
  solver: any,
  module: ModuleRecord,
  findings: Finding[],
  pathConditions: any[],
  context: AnalysisContext
) {
  const file = module.id;
  const condition = node.test;
  const predicate = encodePredicate(condition, z3, solver, module);
  
  if (predicate && typeof predicate !== 'string') {
    // 1. Check if the 'then' branch is reachable
    solver.push();
    try {
        for (const pc of pathConditions) {
            if (pc) solver.add(pc);
        }
        solver.add(predicate);
        
        const result = await solver.check();

        if (result === "sat") {
            // SAT -> Candidate for Layer 4 Proof
            const seedInput = await extractModel(solver);
            context.candidateBranches.push({
                file: file,
                line: node.consequent.loc?.start.line ?? 0,
                instrumentedCode: instrumentCode(module.sourceText, file) ?? "",
                seedInput
            });
        }

        if (result === "unsat") {
          findings.push({
            rule: "constant-condition",
            severity: "warning",
            confidence: "high",
            message: "Logical path is mathematically unreachable (Always False).",
            file: file,
            location: node.consequent.loc,
            evidence: { reason: "unsat-path-then" },
          });
        } else {
            // Recurse into nested blocks if reachable
            if (node.consequent.type === "BlockStatement") {
                for (const stmt of node.consequent.body) {
                    if (stmt.type === "IfStatement") {
                        await analyzeIfStatement(stmt, z3, solver, module, findings, [...pathConditions, predicate], context);
                    }
                }
            }
        }
    } catch (e) {
        // Ignore
    }
    solver.pop();

    // 2. Check if the 'else' branch is reachable
    if (node.alternate) {
        solver.push();
        try {
            for (const pc of pathConditions) {
                if (pc) solver.add(pc);
            }
            solver.add(z3.Not(predicate));
            
            const result = await solver.check();

            if (result === "sat") {
                // SAT -> Candidate for Layer 4 Proof (Else branch)
                const seedInput = await extractModel(solver);
                context.candidateBranches.push({
                    file: file,
                    line: node.alternate.loc?.start.line ?? 0,
                    instrumentedCode: instrumentCode(module.sourceText, file) ?? "",
                    seedInput
                });
            }

            if (result === "unsat") {
                findings.push({
                    rule: "constant-condition",
                    severity: "warning",
                    confidence: "high",
                    message: "Logical path is mathematically unreachable (Always True).",
                    file: file,
                    location: node.alternate.loc,
                    evidence: { reason: "unsat-path-else" },
                });
            } else {
                // Recurse into else branch
                if (node.alternate.type === "BlockStatement") {
                    for (const stmt of node.alternate.body) {
                        if (stmt.type === "IfStatement") {
                            await analyzeIfStatement(stmt, z3, solver, module, findings, [...pathConditions, z3.Not(predicate)], context);
                        }
                    }
                } else if (node.alternate.type === "IfStatement") {
                    await analyzeIfStatement(node.alternate, z3, solver, module, findings, [...pathConditions, z3.Not(predicate)], context);
                }
            }
        } catch (e) {
            // Ignore
        }
        solver.pop();
    }
  }
}

function resolveFunctionLiteral(name: string, module: ModuleRecord): any | null {
  const ast = module.ast as any;
  let returnValue: any = null;
  let found = false;

  walkAst(ast, (n) => {
    const node = n as any;
    if (found) return;
    if (node.type === "FunctionDeclaration" && node.id?.name === name) {
      const body = node.body.body;
      if (body.length === 1 && body[0].type === "ReturnStatement") {
        const arg = body[0].argument;
        if (arg.type === "BooleanLiteral" || arg.type === "NumericLiteral" || arg.type === "StringLiteral") {
          returnValue = arg.value;
          found = true;
        } else if (arg.type === "Literal") {
          returnValue = arg.value;
          found = true;
        }
      }
    }
  });
  return found ? returnValue : null;
}

function encodeLiteral(value: any, z3: any): any {
  if (typeof value === 'number') {
    // Always use Real for numbers to avoid sort mismatches when comparing with Real identifiers
    return z3.Real.val(value);
  }
  if (typeof value === 'boolean') {
    return z3.Bool.val(value);
  }
  return null;
}

function flattenMemberExpression(node: any): string | null {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") {
    const obj = flattenMemberExpression(node.object);
    const prop = node.computed ? null : (node.property.type === "Identifier" ? node.property.name : null);
    if (obj && prop) return `${obj}.${prop}`;
  }
  return null;
}

export function encodePredicate(node: any, z3: any, solver?: any, module?: ModuleRecord): any {
  if (!node) return null;

  if (node.type === "BinaryExpression") {
    const left = encodePredicate(node.left, z3, solver, module);
    const right = encodePredicate(node.right, z3, solver, module);
    
    if (left && right && typeof left !== 'string' && typeof right !== 'string') {
      try {
          switch (node.operator) {
            case "===":
            case "==":
              return left.eq(right);
            case "!==":
            case "!=":
              return z3.Not(left.eq(right));
            case ">":
              return left.gt(right);
            case "<":
              return left.lt(right);
            case ">=":
              return left.ge(right);
            case "<=":
              return left.le(right);
          }
      } catch (e) {
          return null;
      }
    }
  }
  
  if (node.type === "Identifier") {
    try {
        // Use Real for identifiers to handle both integers and floats in JS
        return z3.Real.const(node.name);
    } catch (e) {
        return null;
    }
  }

  if (node.type === "MemberExpression") {
    const name = flattenMemberExpression(node);
    if (name) {
      return z3.Real.const(name);
    }
  }
  
  if (node.type === "NumericLiteral" || (node.type === "Literal" && typeof node.value === 'number')) {
    return encodeLiteral(node.value, z3);
  }

  if (node.type === "BooleanLiteral" || (node.type === "Literal" && typeof node.value === 'boolean')) {
    return z3.Bool.val(node.value);
  }

  if (node.type === "UnaryExpression") {
    const arg = encodePredicate(node.argument, z3, solver, module);
    if (arg) {
      if (node.operator === "!") {
        if (z3.isBool(arg)) return z3.Not(arg);
        if (z3.isArith(arg)) {
          const zero = z3.isInt(arg) ? z3.Int.val(0) : z3.Real.val(0);
          return arg.eq(zero);
        }
        return z3.Not(arg);
      }
      if (node.operator === "-") {
        if (z3.isArith(arg)) return arg.neg();
      }
    }
  }

  if (node.type === "CallExpression") {
    const callee = node.callee;
    // Handle Math.random()
    if (callee.type === "MemberExpression" && 
        callee.object.type === "Identifier" && callee.object.name === "Math" &&
        callee.property.type === "Identifier" && callee.property.name === "random") {
      const randVar = z3.Real.const(`math_random_${node.loc?.start.line}_${node.loc?.start.column}`);
      if (solver) {
        solver.add(randVar.ge(z3.Real.val(0)));
        solver.add(randVar.lt(z3.Real.val(1)));
      }
      return randVar;
    }
    // Handle simple pure functions in the same module
    if (callee.type === "Identifier" && module) {
      const val = resolveFunctionLiteral(callee.name, module);
      if (val !== null) {
        return encodeLiteral(val, z3);
      }
    }
  }

  if (node.type === "LogicalExpression") {
    const left = encodePredicate(node.left, z3, solver, module);
    const right = encodePredicate(node.right, z3, solver, module);
    if (left && right && typeof left !== 'string' && typeof right !== 'string') {
        try {
            if (node.operator === "&&") return z3.And(left, right);
            if (node.operator === "||") return z3.Or(left, right);
        } catch (e) {
            return null;
        }
    }
  }

  return null;
}
