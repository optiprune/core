import { parse as yukuParse, langFromPath, sourceTypeFromPath } from "yuku-parser";
import { print as yukuPrint } from "yuku-codegen";
import {walk as yukuWalk} from "yuku-ast";
import { isSfcPath, extractSfcScript } from "./parser.js";
/**
 * Instruments code for concolic execution using yuku-parser and yuku-codegen.
 * It injects tracing hooks around conditional branches and function calls.
 *
 * For SFC files (.vue, .svelte, .astro) only the <script> block is instrumented;
 * the surrounding template/markup is left untouched.
 */
export function instrumentCode(code: string, filename: string): string | null {
  try {
    // SFC pre-processing: extract the <script> block before parsing
    let codeToParse = code;
    let lang: "ts" | "tsx" | "jsx" | "js" | "dts";

    if (isSfcPath(filename)) {
      const extracted = extractSfcScript(code, filename);
      if (!extracted.hasScript) {
        // Template-only SFC: nothing to instrument
        return code;
      }
      codeToParse = extracted.scriptContent;
      lang = extracted.lang;
    } else {
      lang = langFromPath(filename) ?? "tsx";
    }

    const sourceType = sourceTypeFromPath(filename) ?? "module";
    const result = yukuParse(codeToParse, { lang, sourceType });
    const ast = result.program;
    const coverageVariable = "__coverage__";

    // Helper to get line number from byte offset
    const getLine = (offset: number): number => {
      const before = code.slice(0, Math.max(0, offset));
      return before.split("\n").length;
    };

    // Helper to create AST nodes (ESTree compatible)
    const createLiteral = (val: string | number | boolean) => ({ type: "Literal", value: val, raw: JSON.stringify(val) });
    const createIdentifier = (name: string) => ({ type: "Identifier", name });
    const createMemberExpression = (obj: any, prop: any) => ({ type: "MemberExpression", object: obj, property: prop, computed: false });
    const createCallExpression = (callee: any, args: any[]) => ({ type: "CallExpression", callee, arguments: args });
    const createExpressionStatement = (exp: any) => ({ type: "ExpressionStatement", expression: exp });

    // Mark injected nodes to avoid re-instrumentation
    const markInjected = (node: any) => {
      if (node && node.type === "CallExpression") {
        (node.callee as any)._concolicInstrumented = true;
      }
      return node;
    };

    // 1. Initialize coverage at program start
    const initCoverage = createExpressionStatement(
      markInjected(
        createCallExpression(
          createMemberExpression(createIdentifier(coverageVariable), createIdentifier("init")),
          [createLiteral(filename)]
        )
      )
    );
    (ast.body as any[]).unshift(initCoverage);

    // 2. Traverse and instrument
    yukuWalk(ast, {
      enter: (node: any, parent: any) => {
        // Avoid re-instrumenting our own injected calls
        if (node.type === "CallExpression" && (node.callee as any)?._concolicInstrumented) {
          return;
        }

        const line = getLine(node.start);

        // Instrument IfStatement
        if (node.type === "IfStatement") {
          const traceCall = markInjected(
            createCallExpression(
              createMemberExpression(createIdentifier(coverageVariable), createIdentifier("traceBranch")),
              [createLiteral(filename), createLiteral(line), node.test]
            )
          );
          // Wrap test with sequence expression: (traceBranch(...), originalTest)
          node.test = {
            type: "SequenceExpression",
            expressions: [traceCall, node.test]
          };
        }

        // Instrument Functions
        if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
          const functionName = node.id?.name || "anonymous";
          const traceCall = createExpressionStatement(
            markInjected(
              createCallExpression(
                createMemberExpression(createIdentifier(coverageVariable), createIdentifier("traceFunction")),
                [createLiteral(filename), createLiteral(line), createLiteral(functionName)]
              )
            )
          );

          if (node.body.type === "BlockStatement") {
            node.body.body.unshift(traceCall);
          } else {
            // Arrow function with implicit return: () => expr  ->  () => { trace(); return expr; }
            node.body = {
              type: "BlockStatement",
              body: [
                traceCall,
                { type: "ReturnStatement", argument: node.body }
              ]
            };
          }
        }

        // Instrument CallExpression
        if (node.type === "CallExpression" && !((node.callee as any)?._concolicInstrumented)) {
          const calleeName = node.callee.type === "Identifier" ? node.callee.name : "unknown";
          const tracedCall = markInjected(
            createCallExpression(
              createMemberExpression(createIdentifier(coverageVariable), createIdentifier("traceAndExecuteCall")),
              [
                createLiteral(filename),
                createLiteral(line),
                createLiteral(calleeName),
                node.callee,
                { type: "ArrayExpression", elements: node.arguments }
              ]
            )
          );

          // We need to replace the node in the parent. 
          if (parent) {
            for (const key in parent) {
              if (parent[key] === node) {
                parent[key] = tracedCall;
                break;
              } else if (Array.isArray(parent[key])) {
                const idx = parent[key].indexOf(node);
                if (idx !== -1) {
                  parent[key][idx] = tracedCall;
                  break;
                }
              }
            }
          }
        }
      }
    });

    const output = yukuPrint(ast);
    const instrumentedScript = output.code;

    // For SFC files: splice the instrumented script back into the original source
    // so that the template/style sections are preserved.
    if (isSfcPath(filename)) {
      // Find the exact <script...>...</script> region in the original source and
      // replace it with the instrumented version.
      const scriptTagRe = /<script(\b[^>]*)?>([\s\S]*?)<\/script>/i;
      const m = scriptTagRe.exec(code);
      if (m && m.index !== undefined) {
        const before = code.slice(0, m.index);
        const after = code.slice(m.index + m[0].length);
        const attrs = m[1] ?? "";
        return `${before}<script${attrs}>${instrumentedScript}</script>${after}`;
      }
      // Fallback: return just the instrumented script (should not happen)
      return instrumentedScript;
    }

    return instrumentedScript;
  } catch (err) {
    console.error(`[Instrumentation] Failed to instrument ${filename}:`, err);
    return null;
  }
}
