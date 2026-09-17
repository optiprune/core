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
    z3 = Context("main");
  } catch (e) {
    console.warn(
      `[Layer 3] Failed to initialize Z3 solver: ${e instanceof Error ? e.message : String(e)}`,
    );
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

async function analyzeModuleLogic(
  module: ModuleRecord,
  z3: any,
  context: AnalysisContext,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const ast = module.ast as any;

  const functionNodes: any[] = [];
  walkAst(ast, (node) => {
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "ArrowFunctionExpression" ||
      node.type === "FunctionExpression"
    ) {
      functionNodes.push(node);
    }
  });

  for (const node of functionNodes) {
    const body = node.body;
    if (body.type === "BlockStatement") {
      const solver = new z3.Solver();

      // Apply SMT timeout from configuration
      const timeout = context.options.layers.smtTimeoutMs;
      if (timeout > 0) {
        solver.set("timeout", timeout);
      }

      const pathFindings: Finding[] = [];
      await analyzeSsaStatements(
        body.body ?? [],
        z3,
        solver,
        module,
        pathFindings,
        [],
        context,
        seedSsaState(node, z3),
      );
      findings.push(...pathFindings);
    }
  }

  return findings;
}

async function analyzeFunctionPaths(
  block: any,
  z3: any,
  solver: any,
  module: ModuleRecord,
  context: AnalysisContext,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const body = block.body || [];

  for (const stmt of body) {
    if (stmt.type === "IfStatement") {
      await analyzeIfStatement(stmt, z3, solver, module, findings, [], context);
    }
  }

  return findings;
}

type SsaState = {
  bindings: Map<string, any>;
  versions: Map<string, number>;
};

function cloneSsaState(state: SsaState): SsaState {
  return { bindings: new Map(state.bindings), versions: new Map(state.versions) };
}

function nextSsaValue(name: string, value: any, z3: any, state: SsaState): any {
  const version = (state.versions.get(name) ?? -1) + 1;
  state.versions.set(name, version);
  const symbol = value ?? z3.Real.const(`${name}_${version}`);
  state.bindings.set(name, symbol);
  return symbol;
}

function seedSsaState(node: any, z3: any): SsaState {
  const state: SsaState = { bindings: new Map(), versions: new Map() };
  for (const param of node.params ?? []) {
    if (param.type === "Identifier") nextSsaValue(param.name, null, z3, state);
  }
  return state;
}

function isTerminalStatement(stmt: any): boolean {
  if (
    stmt?.type === "ReturnStatement" ||
    stmt?.type === "ThrowStatement" ||
    stmt?.type === "BreakStatement" ||
    stmt?.type === "ContinueStatement"
  ) {
    return true;
  }
  if (stmt?.type === "BlockStatement") {
    const last = stmt.body?.[stmt.body.length - 1];
    return Boolean(last && isTerminalStatement(last));
  }
  return false;
}

async function analyzeSsaStatements(
  statements: any[],
  z3: any,
  solver: any,
  module: ModuleRecord,
  findings: Finding[],
  pathConditions: any[],
  context: AnalysisContext,
  state: SsaState,
): Promise<SsaState> {
  for (const stmt of statements) {
    if (stmt.type === "VariableDeclaration") {
      for (const declaration of stmt.declarations ?? []) {
        if (declaration.id?.type === "Identifier") {
          const value = declaration.init
            ? encodePredicate(declaration.init, z3, solver, module, state.bindings)
            : null;
          nextSsaValue(declaration.id.name, value, z3, state);
        }
      }
      continue;
    }
    if (stmt.type === "ExpressionStatement" && stmt.expression?.type === "AssignmentExpression") {
      const assignment = stmt.expression;
      if (assignment.left?.type === "Identifier") {
        const value = encodePredicate(assignment.right, z3, solver, module, state.bindings);
        nextSsaValue(assignment.left.name, value, z3, state);
      }
      continue;
    }
    if (stmt.type === "ExpressionStatement" && stmt.expression?.type === "UpdateExpression") {
      const target = stmt.expression.argument;
      if (target?.type === "Identifier") {
        const previous = state.bindings.get(target.name) ?? z3.Real.const(`${target.name}_unknown`);
        const delta = z3.Real.val(1);
        nextSsaValue(
          target.name,
          stmt.expression.operator === "--" ? previous.sub(delta) : previous.add(delta),
          z3,
          state,
        );
      }
      continue;
    }
    if (stmt.type === "IfStatement") {
      const predicate = encodePredicate(stmt.test, z3, solver, module, state.bindings);
      if (!predicate || typeof predicate === "string" || !z3.isBool(predicate)) continue;
      const thenState = cloneSsaState(state);
      const elseState = cloneSsaState(state);
      await analyzeSsaBranch(
        stmt.consequent,
        predicate,
        pathConditions,
        true,
        z3,
        solver,
        module,
        findings,
        context,
        thenState,
      );
      if (stmt.alternate) {
        await analyzeSsaBranch(
          stmt.alternate,
          z3.Not(predicate),
          pathConditions,
          false,
          z3,
          solver,
          module,
          findings,
          context,
          elseState,
        );
      }
      const mergedNames = new Set([...thenState.bindings.keys(), ...elseState.bindings.keys()]);
      for (const name of mergedNames) {
        const thenValue = thenState.bindings.get(name) ?? state.bindings.get(name);
        const elseValue = elseState.bindings.get(name) ?? state.bindings.get(name);
        if (thenValue === undefined && elseValue === undefined) continue;
        if (thenValue === undefined || elseValue === undefined) {
          nextSsaValue(name, null, z3, state);
        } else if (thenValue !== elseValue) {
          nextSsaValue(name, z3.If(predicate, thenValue, elseValue), z3, state);
        } else {
          state.bindings.set(name, thenValue);
        }
      }
      continue;
    }
    if (stmt.type === "BlockStatement") {
      await analyzeSsaStatements(
        stmt.body ?? [],
        z3,
        solver,
        module,
        findings,
        pathConditions,
        context,
        state,
      );
    }
    if (isTerminalStatement(stmt)) break;
  }
  return state;
}

async function analyzeSsaBranch(
  branch: any,
  condition: any,
  pathConditions: any[],
  isThen: boolean,
  z3: any,
  solver: any,
  module: ModuleRecord,
  findings: Finding[],
  context: AnalysisContext,
  state: SsaState,
) {
  solver.push();
  try {
    for (const path of pathConditions) solver.add(path);
    solver.add(condition);
    const result = await solver.check();
    if (result === "unsat") {
      findings.push({
        rule: "constant-condition",
        severity: "warning",
        confidence: "high",
        message: isThen
          ? "Logical path is mathematically unreachable (Always False)."
          : "Logical path is mathematically unreachable (Always True).",
        file: module.id,
        location: branch.loc,
        evidence: { reason: isThen ? "unsat-path-then" : "unsat-path-else" },
      });
      return;
    }
    if (branch.type === "BlockStatement") {
      await analyzeSsaStatements(
        branch.body ?? [],
        z3,
        solver,
        module,
        findings,
        [...pathConditions, condition],
        context,
        state,
      );
    } else if (branch.type === "IfStatement") {
      await analyzeSsaStatements(
        [branch],
        z3,
        solver,
        module,
        findings,
        [...pathConditions, condition],
        context,
        state,
      );
    }
  } catch {
    // A solver/backend failure must not invalidate the rest of the analysis.
  } finally {
    solver.pop();
  }
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
  context: AnalysisContext,
) {
  const file = module.id;
  const condition = node.test;
  const predicate = encodePredicate(condition, z3, solver, module);

  if (predicate && typeof predicate !== "string") {
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
          seedInput,
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
              await analyzeIfStatement(
                stmt,
                z3,
                solver,
                module,
                findings,
                [...pathConditions, predicate],
                context,
              );
            }
          }
        }
      }
    } catch (e) {
      // Ignore
    } finally {
      solver.pop();
    }

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
            seedInput,
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
                await analyzeIfStatement(
                  stmt,
                  z3,
                  solver,
                  module,
                  findings,
                  [...pathConditions, z3.Not(predicate)],
                  context,
                );
              }
            }
          } else if (node.alternate.type === "IfStatement") {
            await analyzeIfStatement(
              node.alternate,
              z3,
              solver,
              module,
              findings,
              [...pathConditions, z3.Not(predicate)],
              context,
            );
          }
        }
      } catch (e) {
        // Ignore
      } finally {
        solver.pop();
      }
    }
  }
}

function evaluateStaticExpression(node: any, module: ModuleRecord, depth = 0): any | null {
  if (!node || depth > 12) return null;
  if (
    node.type === "Literal" ||
    node.type === "NumericLiteral" ||
    node.type === "StringLiteral" ||
    node.type === "BooleanLiteral"
  )
    return node.value;
  if (node.type === "Identifier") return resolveFunctionLiteral(node.name, module, depth + 1);
  if (node.type === "UnaryExpression") {
    const value = evaluateStaticExpression(node.argument, module, depth + 1);
    if (value === null) return null;
    if (node.operator === "-") return -value;
    if (node.operator === "+") return +value;
    if (node.operator === "!") return !value;
  }
  if (node.type === "BinaryExpression") {
    const left = evaluateStaticExpression(node.left, module, depth + 1);
    const right = evaluateStaticExpression(node.right, module, depth + 1);
    if (left === null || right === null) return null;
    switch (node.operator) {
      case "+":
        return left + right;
      case "-":
        return left - right;
      case "*":
        return left * right;
      case "/":
        return left / right;
      case "%":
        return left % right;
      case "===":
        return left === right;
      case "!==":
        return left !== right;
      case "==":
        return left == right;
      case "!=":
        return left != right;
    }
  }
  return null;
}

function resolveFunctionLiteral(name: string, module: ModuleRecord, depth = 0): any | null {
  if (depth > 12) return null;
  const ast = module.ast as any;
  let returnValue: any = null;
  let found = false;

  walkAst(ast, (n) => {
    const node = n as any;
    if (found) return;
    if (node.type === "FunctionDeclaration" && node.id?.name === name) {
      const body = node.body?.body ?? [];
      if (body.length === 1 && body[0].type === "ReturnStatement") {
        const evaluated = evaluateStaticExpression(body[0].argument, module, depth + 1);
        if (evaluated !== null) {
          returnValue = evaluated;
          found = true;
        }
      }
    }
  });
  return found ? returnValue : null;
}

function encodeLiteral(value: any, z3: any): any {
  if (typeof value === "number") {
    // Always use Real for numbers to avoid sort mismatches when comparing with Real identifiers
    return z3.Real.val(value);
  }
  if (typeof value === "boolean") {
    return z3.Bool.val(value);
  }
  return null;
}

function flattenMemberExpression(node: any): string | null {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") {
    const obj = flattenMemberExpression(node.object);
    const prop = node.computed
      ? null
      : node.property.type === "Identifier"
        ? node.property.name
        : null;
    if (obj && prop) return `${obj}.${prop}`;
  }
  return null;
}

/**
 * Raw identifier names are not sound SMT variables when their lexical
 * binding can be reassigned or shadowed.
 * The SSA traversal supplies safe bindings for analyzed function bodies; this
 * fallback remains conservative for expressions outside that traversal.
 */
function hasUnsafeIdentifierBinding(name: string, module?: ModuleRecord): boolean {
  if (!module?.ast) return true;
  let declarations = 0;
  let unsafe = false;
  walkAst(module.ast, (node: any) => {
    if (
      node.type === "VariableDeclarator" &&
      node.id?.type === "Identifier" &&
      node.id.name === name
    ) {
      declarations += 1;
    }
    if (
      node.type === "AssignmentExpression" &&
      node.left?.type === "Identifier" &&
      node.left.name === name
    ) {
      unsafe = true;
    }
    if (
      node.type === "UpdateExpression" &&
      node.argument?.type === "Identifier" &&
      node.argument.name === name
    ) {
      unsafe = true;
    }
  });
  // Parameters and globals remain usable symbolic inputs. A binding becomes
  // unsafe once it is written or the same name is declared more than once.
  return unsafe || declarations > 1;
}

export function encodePredicate(
  node: any,
  z3: any,
  solver?: any,
  module?: ModuleRecord,
  bindings?: Map<string, any>,
): any {
  if (!node) return null;

  if (node.type === "BinaryExpression") {
    const left = encodePredicate(node.left, z3, solver, module, bindings);
    const right = encodePredicate(node.right, z3, solver, module, bindings);

    if (left && right && typeof left !== "string" && typeof right !== "string") {
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
    // Identifier binding is scope-sensitive. Without a lexical resolver, treating
    // a same-named function declaration as a constant is unsound under shadowing,
    // parameters, reassignment, and block scope. Keep the value symbolic instead.
    if (bindings?.has(node.name)) return bindings.get(node.name);
    if (hasUnsafeIdentifierBinding(node.name, module)) return null;
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

  if (
    node.type === "NumericLiteral" ||
    (node.type === "Literal" && typeof node.value === "number")
  ) {
    return encodeLiteral(node.value, z3);
  }

  if (
    node.type === "BooleanLiteral" ||
    (node.type === "Literal" && typeof node.value === "boolean")
  ) {
    return z3.Bool.val(node.value);
  }

  if (node.type === "UnaryExpression") {
    const arg = encodePredicate(node.argument, z3, solver, module, bindings);
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
    if (
      callee.type === "MemberExpression" &&
      callee.object.type === "Identifier" &&
      callee.object.name === "Math" &&
      callee.property.type === "Identifier" &&
      callee.property.name === "random"
    ) {
      const randVar = z3.Real.const(
        `math_random_${node.loc?.start.line}_${node.loc?.start.column}`,
      );
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
    const left = encodePredicate(node.left, z3, solver, module, bindings);
    const right = encodePredicate(node.right, z3, solver, module, bindings);
    if (left && right && typeof left !== "string" && typeof right !== "string") {
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
