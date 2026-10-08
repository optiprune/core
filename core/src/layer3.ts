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

/**
 * The symbolic pass deliberately uses expressions as SSA values.  A merged
 * value is therefore a real Z3 ITE (our phi node), rather than a value copied
 * from one of the paths.  This keeps assignments made on either side of a
 * join visible to all following predicates.
 */
const MAX_LOOP_UNROLL = 4;

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

function branchTerminates(branch: any): boolean {
  if (!branch) return false;
  if (isTerminalStatement(branch)) return true;
  if (branch.type === "BlockStatement") {
    for (const statement of branch.body ?? []) {
      if (branchTerminates(statement)) return true;
    }
    return false;
  }
  if (branch.type === "IfStatement") {
    return Boolean(
      branch.alternate && branchTerminates(branch.consequent) && branchTerminates(branch.alternate),
    );
  }
  return false;
}

/**
 * A loop-body state can only be used as a back-edge state when execution can
 * continue to the next loop header. A direct break/return/throw exits that
 * path instead. We keep conditional exits conservative: if a body contains
 * one, writes made by the body are invalidated before the back-edge merge so
 * an exit value can never be mistaken for a looping value.
 */
function hasNonBackEdgeExit(node: any, nestedBreakTarget = false): boolean {
  if (!node || typeof node !== "object") return false;
  if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  ) {
    return false;
  }
  if (node.type === "ReturnStatement" || node.type === "ThrowStatement") return true;
  // An unlabeled break exits the nearest loop or switch. A labeled break may
  // target this loop (or an outer labeled loop), so it is always treated as a
  // possible non-back-edge exit when using this intentionally conservative
  // heuristic.
  if (node.type === "BreakStatement") return node.label ? true : !nestedBreakTarget;

  const childNestedLoop =
    nestedBreakTarget ||
    node.type === "WhileStatement" ||
    node.type === "DoWhileStatement" ||
    node.type === "ForStatement" ||
    node.type === "ForInStatement" ||
    node.type === "ForOfStatement" ||
    node.type === "SwitchStatement";
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "parent") continue;
    if (Array.isArray(value)) {
      if (value.some((child) => hasNonBackEdgeExit(child, childNestedLoop))) return true;
    } else if (hasNonBackEdgeExit(value, childNestedLoop)) {
      return true;
    }
  }
  return false;
}

function isSyntacticallyFalse(node: any): boolean {
  return (
    (node?.type === "BooleanLiteral" && node.value === false) ||
    (node?.type === "Literal" && node.value === false)
  );
}

function asBooleanPredicate(value: any, z3: any): any {
  if (value && z3.isBool(value)) return value;
  if (value && z3.isArith(value)) return z3.Not(value.eq(z3.Real.val(0)));
  return null;
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
      const predicate = asBooleanPredicate(
        encodePredicate(stmt.test, z3, solver, module, state.bindings),
        z3,
      );
      if (!predicate) continue;
      const thenState = cloneSsaState(state);
      const elseState = cloneSsaState(state);
      const thenReachable = await analyzeSsaBranch(
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
      const elseReachable = stmt.alternate
        ? await analyzeSsaBranch(
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
          )
        : true;
      mergeSsaStates(
        state,
        thenState,
        elseState,
        predicate,
        z3,
        thenReachable && !branchTerminates(stmt.consequent),
        elseReachable && (!stmt.alternate || !branchTerminates(stmt.alternate)),
      );
      continue;
    }
    if (stmt.type === "WhileStatement" || stmt.type === "DoWhileStatement") {
      await analyzeSsaLoop(stmt, z3, solver, module, findings, pathConditions, context, state);
      continue;
    }
    if (stmt.type === "ForOfStatement" || stmt.type === "ForInStatement") {
      await analyzeSsaIterableLoop(
        stmt,
        z3,
        solver,
        module,
        findings,
        pathConditions,
        context,
        state,
      );
      continue;
    }
    if (stmt.type === "ForStatement") {
      // Treat the initializer and update as ordinary SSA statements and use
      // the same bounded loop engine for the test/body.  This covers the
      // common numeric-loop form without pretending to prove unbounded JS.
      if (stmt.init?.type === "VariableDeclaration") {
        await analyzeSsaStatements(
          [stmt.init],
          z3,
          solver,
          module,
          findings,
          pathConditions,
          context,
          state,
        );
      } else if (stmt.init?.type === "ExpressionStatement") {
        await analyzeSsaStatements(
          [stmt.init],
          z3,
          solver,
          module,
          findings,
          pathConditions,
          context,
          state,
        );
      }
      const loop = { ...stmt, test: stmt.test ?? { type: "Literal", value: true, raw: "true" } };
      await analyzeSsaLoop(
        loop,
        z3,
        solver,
        module,
        findings,
        pathConditions,
        context,
        state,
        stmt.update,
      );
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

async function analyzeSsaIterableLoop(
  node: any,
  z3: any,
  solver: any,
  module: ModuleRecord,
  findings: Finding[],
  pathConditions: any[],
  context: AnalysisContext,
  state: SsaState,
): Promise<void> {
  // An iterable may be empty or may execute an arbitrary number of times.
  // Analyze one symbolic body execution and merge it with the zero-iteration
  // path.  This is deliberately conservative: values written in the body
  // cannot remain falsely constant after an unknown iterable loop.
  const loopMayExecute = z3.Bool.const(
    `iterable_loop_${node.loc?.start.line ?? 0}_${node.loc?.start.column ?? 0}`,
  );
  const bodyState = cloneSsaState(state);
  const target = node.left;
  if (target?.type === "VariableDeclaration") {
    for (const declaration of target.declarations ?? []) {
      if (declaration.id?.type === "Identifier") {
        nextSsaValue(declaration.id.name, null, z3, bodyState);
      }
    }
  } else if (target?.type === "Identifier") {
    nextSsaValue(target.name, null, z3, bodyState);
  }

  const findingStart = findings.length;
  const reachable = await analyzeSsaBranch(
    node.body,
    loopMayExecute,
    pathConditions,
    true,
    z3,
    solver,
    module,
    findings,
    context,
    bodyState,
  );
  if (reachable) {
    mergeSsaStates(state, bodyState, state, loopMayExecute, z3, true, true);
  } else {
    // A symbolic loop guard should be satisfiable.  If an analyzer backend
    // rejects the body, invalidate its writes rather than retaining stale
    // constants from before the unsupported loop.
    for (let index = findingStart; index < findings.length; index++) {
      const finding = findings[index];
      if (finding) finding.evidence.loop = true;
    }
    mergeSsaStates(state, bodyState, state, loopMayExecute, z3, false, true);
  }
}

function mergeSsaStates(
  state: SsaState,
  thenState: SsaState,
  elseState: SsaState,
  predicate: any,
  z3: any,
  thenReachable = true,
  elseReachable = true,
): void {
  const mergedNames = new Set([
    ...state.bindings.keys(),
    ...thenState.bindings.keys(),
    ...elseState.bindings.keys(),
  ]);
  for (const name of mergedNames) {
    const before = state.bindings.get(name);
    const thenValue = thenState.bindings.get(name) ?? before;
    const elseValue = elseState.bindings.get(name) ?? before;
    if (thenValue === undefined && elseValue === undefined) continue;
    const selected = !thenReachable
      ? elseValue
      : !elseReachable
        ? thenValue
        : thenValue === elseValue
          ? thenValue
          : (z3.isBool(thenValue) && z3.isBool(elseValue)) ||
              (z3.isArith(thenValue) && z3.isArith(elseValue))
            ? z3.If(predicate, thenValue, elseValue)
            : null;
    if (selected !== undefined) nextSsaValue(name, selected, z3, state);
  }
}

async function analyzeSsaLoop(
  node: any,
  z3: any,
  solver: any,
  module: ModuleRecord,
  findings: Finding[],
  pathConditions: any[],
  context: AnalysisContext,
  state: SsaState,
  update?: any,
): Promise<void> {
  let current = cloneSsaState(state);
  const isDoWhile = node.type === "DoWhileStatement";
  for (let iteration = 0; iteration < MAX_LOOP_UNROLL; iteration++) {
    // A do-while executes its body once before evaluating the test.
    const predicate =
      isDoWhile && iteration === 0
        ? z3.Bool.val(true)
        : encodePredicate(node.test, z3, solver, module, current.bindings);
    if (!predicate || typeof predicate === "string" || !z3.isBool(predicate)) return;
    solver.push();
    let loopResult: any;
    try {
      for (const path of pathConditions) solver.add(path);
      solver.add(predicate);
      loopResult = await solver.check();
    } finally {
      solver.pop();
    }
    if (loopResult === "unsat") {
      // A standard while tests its body condition at iteration 0. A do-while
      // performs its first test only after the initial body execution.
      const isFirstTest = isDoWhile ? iteration === 1 : iteration === 0;
      if (!isFirstTest || (isDoWhile && isSyntacticallyFalse(node.test))) break;
      findings.push({
        rule: "constant-condition",
        severity: "warning",
        confidence: "high",
        message: "Logical path is mathematically unreachable (Always False).",
        file: module.id,
        location: node.body?.loc,
        evidence: {
          reason: "unsat-path-then",
          phi: true,
          loop: true,
          iteration,
          ...(isDoWhile && { doWhile: true }),
        },
      });
      return;
    }
    const bodyState = cloneSsaState(current);
    const findingStart = findings.length;
    const reachable = await analyzeSsaBranch(
      node.body,
      predicate,
      pathConditions,
      true,
      z3,
      solver,
      module,
      findings,
      context,
      bodyState,
    );
    if (!reachable) {
      for (let index = findingStart; index < findings.length; index++) {
        const finding = findings[index];
        if (finding) {
          finding.evidence.loop = true;
          finding.evidence.iteration = iteration;
        }
      }
      return;
    }
    if (update) {
      await analyzeSsaStatements(
        [{ type: "ExpressionStatement", expression: update }],
        z3,
        solver,
        module,
        findings,
        [...pathConditions, predicate],
        context,
        bodyState,
      );
    }
    if (hasNonBackEdgeExit(node.body)) {
      // The body state may include values from a break/return/throw path.
      // Do not feed those concrete values into the loop-header phi as if they
      // were guaranteed to reach the back edge. Unknown values preserve sound
      // reachability without claiming that the exit path iterates again.
      for (const name of new Set([...current.bindings.keys(), ...bodyState.bindings.keys()])) {
        if (bodyState.bindings.get(name) !== current.bindings.get(name)) {
          nextSsaValue(name, null, z3, bodyState);
        }
      }
    }
    // The next iteration is the loop-header phi. If the current header
    // predicate is true, execution takes the body/back-edge value; otherwise
    // the loop is skipped and the pre-loop/header value is retained. Passing
    // `current` first here reverses those arms and makes values written in a
    // loop appear to have happened on the exit path, producing false
    // `constant-condition` findings in plugin-style code.
    const next = cloneSsaState(current);
    mergeSsaStates(next, bodyState, current, predicate, z3, true, true);
    current = next;
  }
  // State after the bounded loop is the conservative header state.  We do not
  // report the bound as an error; only solver-proven infeasible bodies above
  // produce findings.
  state.bindings = current.bindings;
  state.versions = current.versions;
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
): Promise<boolean> {
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
        evidence: {
          reason: isThen ? "unsat-path-then" : "unsat-path-else",
          phi: true,
        },
      });
      return false;
    }
    const branchStatements = branch.type === "BlockStatement" ? (branch.body ?? []) : [branch];
    await analyzeSsaStatements(
      branchStatements,
      z3,
      solver,
      module,
      findings,
      [...pathConditions, condition],
      context,
      state,
    );
    // Only UNSAT proves that a branch is unreachable. `unknown` (for example
    // after an SMT timeout) must remain reachable so the phi merge keeps both
    // incoming values instead of silently selecting the other arm and
    // manufacturing a downstream constant-condition finding.
    return result !== "unsat";
  } catch {
    // Backend/parser failures are inconclusive, not proofs of dead code.
    return true;
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

  if (node.type === "AwaitExpression") {
    const awaited = encodePredicate(node.argument, z3, solver, module, bindings);
    if (awaited) return awaited;
    return z3.Bool.const(
      `unknown_await_${node.loc?.start.line ?? 0}_${node.loc?.start.column ?? 0}`,
    );
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
    // Do not fold ordinary identifier calls here. A module-wide AST walk cannot
    // prove which lexical binding the callee resolves to: a parameter, local
    // declaration, or block binding may shadow a same-named function. Treating
    // `value()` as a module-level pure function in that situation creates a
    // high-confidence false `constant-condition` finding. Pure-call folding
    // must happen only in a scope-aware pass with declaration identity.
    // Ordinary calls remain unsupported here to avoid inventing a return sort
    // for arbitrary JavaScript. AwaitExpression models async/I/O calls as
    // symbolic booleans, which is the conservative case needed by plugin
    // discovery loops.
    return null;
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
