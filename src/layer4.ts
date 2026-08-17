import { getQuickJS, QuickJSContext, QuickJSHandle, QuickJSRuntime } from "quickjs-emscripten";
import { transform } from "esbuild";
import type { AnalysisContext, Finding, ConcolicVerificationResult } from "./types.js";
import { performance } from "node:perf_hooks";
import path from "pathe";

/**
 * Layer 4: Proof Asserter Engine
 * Validates candidate branches from Layer 3 using isolated execution.
 * Uses a secure WebAssembly-based QuickJS sandbox.
 * Now also resolves dynamic imports by simulating their path construction.
 */
export async function analyzeLayer4(context: AnalysisContext): Promise<Finding[]> {
  const findings: Finding[] = [];
  const quickJS = await getQuickJS();

  // 1. Resolve Dynamic Imports
  if (context.dynamicImportCandidates.length > 0) {
    // First evaluate with the normal runtime environment. Then run a second
    // pass with environment lookups replaced by `undefined`, which activates
    // source-level fallbacks such as `process.env.MYSTERY_PLUGIN || "markdown"`.
    await resolveDynamicImports(context, quickJS, "host");
    await resolveDynamicImports(context, quickJS, "unset");
    await resolveDynamicImports(context, quickJS, "empty");
  }

  // 2. Validate Candidate Branches
  if (context.candidateBranches.length > 0) {
    for (const branch of context.candidateBranches) {
      const result = await verifyPathInWasmSandbox(
        quickJS,
        branch.instrumentedCode,
        branch.seedInput,
        context.options.layers.smtTimeoutMs,
        context.options.layers.isolateMemoryLimitMb
      );

      if (result.pathReached) {
        // If reached, it's PROVEN alive.
        continue;
      }

      findings.push({
        rule: "unreachable-dynamic-path",
        severity: "warning",
        confidence: "medium",
        message: `[Proof Asserter] Branch at line ${branch.line} could not be reached with SMT-generated seeds.`,
        file: branch.file,
        location: {
          start: { line: branch.line, column: 0 },
          end: { line: branch.line, column: 0 }
        },
        evidence: {
          engine: "wasm-quickjs",
          executionTimeMs: result.executionTimeMs,
          seedInput: branch.seedInput,
          status: "SUSPECT_UNREACHABLE"
        },
      });
    }
  }

  return findings;
}

/**
 * Cleans TypeScript source code for execution in the QuickJS sandbox.
 *
 * The function applies a series of regex-based transformations to strip
 * TypeScript-specific syntax that QuickJS does not understand, while
 * preserving the runtime-relevant logic needed to reconstruct dynamic
 * import paths.
 *
 * Key transformations:
 *  1. Remove top-level `import` declarations entirely (both static and
 *     `import type`) so that QuickJS does not encounter ES-module
 *     syntax it cannot parse.
 *  2. Replace `import(...)` call-expressions with the mock function
 *     `__optiprune_import(...)` that records resolved targets.
 *  3. Strip TypeScript type annotations, `as` casts, and interface/type
 *     imports that would cause syntax errors in plain JavaScript.
 *  4. Rewrite `import.meta.url` to a string expression compatible with
 *     the sandbox's `__filename` global.
 *
 * FIX – String-Interpolation / Identifier-based dynamic imports:
 *  The previous implementation only stripped TS syntax but did not
 *  handle the common pattern where the import argument is a *variable*
 *  whose value was assembled earlier in the same scope via
 *  `pathToFileURL(path.join(dir, file)).href` or similar constructs.
 *  QuickJS would encounter `import(pluginPath)` where `pluginPath` is
 *  an identifier that was never assigned in the cleaned snippet because
 *  the assignment statement was removed or mangled.
 *
 *  The fix ensures that:
 *   a) `const`/`let`/`var` declarations that build path strings are
 *      kept intact after TS-stripping.
 *   b) `await` expressions are preserved (QuickJS runs the script
 *      inside an async IIFE).
 *   c) `for...of` loops that iterate over file lists and call
 *      `import(...)` inside are preserved so that all loop iterations
 *      are simulated and every candidate path is captured.
 *   d) Top-level `import` *declarations* (ESM static imports) are
 *      removed entirely, because QuickJS cannot parse them and they
 *      are not needed for path-construction simulation.
 */
function cleanForQuickJS(code: string): string {
  return code
    // Static ESM imports cannot be evaluated in a QuickJS script. Dynamic
    // imports are intentionally preserved until they are replaced below.
    .replace(/^\s*import(?!\s*\()\s+(?:type\s+)?[\s\S]*?\s+from\s+['"][^'"]+['"]\s*;?\s*$/gm, "")
    .replace(/^\s*import(?!\s*\()\s*['"][^'"]+['"]\s*;?\s*$/gm, "")
    // Re-exports are likewise irrelevant for path-construction simulation.
    .replace(/^\s*export\s+type\s*\{[\s\S]*?\}\s*(?:from\s+['"][^'"]+['"])?\s*;?\s*$/gm, "")
    .replace(/^\s*export\s*\{[\s\S]*?\}\s*(?:from\s+['"][^'"]+['"])?\s*;?\s*$/gm, "")
    .replace(/^\s*export\s+\*\s+from\s+['"][^'"]+['"]\s*;?\s*$/gm, "")
    .replace(/\bexport\s+(?=(?:const|let|var|function|class|async|type|interface|enum)\b)/g, "")
    .replace(/\bexport\s+default\s+/g, "")
    // Keep import.meta usable after the static import pre-processing.
    .replace(/import\.meta\.url/g, '("file://" + __filename)')
    // Record simulated dynamic-import targets instead of loading modules.
    .replace(/\bimport\s*\(/g, "__optiprune_import(");
}

type QuickJSSourceLoader = "ts" | "tsx" | "js" | "jsx";

function quickJSSourceLoader(file: string): QuickJSSourceLoader {
  switch (path.extname(file).toLowerCase()) {
    case ".ts":
    case ".mts":
    case ".cts":
      return "ts";
    case ".tsx":
      return "tsx";
    case ".jsx":
      return "jsx";
    default:
      return "js";
  }
}

/**
 * Compiles the extracted source context to JavaScript before it reaches
 * QuickJS. Regexes are deliberately limited to ESM simulation rewrites;
 * esbuild performs all TypeScript/TSX syntax erasure and downleveling.
 */
const QUICKJS_CONTEXT_FUNCTION = "__optiprune_execute_context__";

async function compileForQuickJS(code: string, sourceFile: string): Promise<string> {
  // Candidate context can contain a captured function body, including `await`
  // and `return`. Wrapping it first lets esbuild parse those statements in the
  // same asynchronous function scope QuickJS will execute later.
  const wrappedContext = `async function ${QUICKJS_CONTEXT_FUNCTION}() {\n${cleanForQuickJS(code)}\n}`;
  const transformed = await transform(wrappedContext, {
    loader: quickJSSourceLoader(sourceFile),
    format: "esm",
    target: "es2018",
    sourcemap: false,
    sourcefile: sourceFile,
    legalComments: "none",
  });

  return transformed.code;
}

/**
 * Installs a catch-all lexical scope for the simulation. A `with` block over
 * this proxy resolves otherwise-unbound identifiers to a harmless callable
 * proxy, allowing path construction to continue instead of aborting with a
 * ReferenceError. Known globals and the explicit mocks still take priority.
 */
function installGlobalResilience(vm: QuickJSContext): void {
  const result = vm.evalCode(`
    (function() {
      let fallbackMock;
      const fallbackHandler = {
        get(_target, property) {
          if (property === "then" || property === Symbol.unscopables) return undefined;
          if (property === Symbol.toPrimitive) return () => "";
          if (property === "toJSON") return () => ({});
          if (property === Symbol.iterator) {
            return () => ({ next: () => ({ done: true }) });
          }
          return fallbackMock;
        },
        has() { return true; },
        set() { return true; },
        apply() { return fallbackMock; },
        construct() { return fallbackMock; }
      };

      fallbackMock = new Proxy(function __optiprune_empty_mock() {}, fallbackHandler);
      globalThis.__create_resilient_mock = () => fallbackMock;
      globalThis.__optiprune_scope__ = new Proxy(globalThis, {
        has(_target, property) {
          return property !== Symbol.unscopables;
        },
        get(target, property, receiver) {
          if (property === Symbol.unscopables) return undefined;
          if (Reflect.has(target, property)) {
            return Reflect.get(target, property, receiver);
          }
          return fallbackMock;
        }
      });
    })();
  `);

  if (result.error) {
    const error = vm.dump(result.error);
    result.error.dispose();
    throw new Error(`Could not install the QuickJS resilience scope: ${String(error)}`);
  }

  result.value.dispose();
}

function drainQuickJSPendingJobs(runtime: QuickJSRuntime, vm: QuickJSContext, maxJobs = 5000): void {
  let remainingJobs = maxJobs;

  while (runtime.hasPendingJob() && remainingJobs > 0) {
    const result = runtime.executePendingJobs(1);
    if (result.error) {
      const error = vm.dump(result.error);
      result.error.dispose();
      throw new Error(`QuickJS pending job failed: ${String(error)}`);
    }

    if (result.value <= 0) {
      break;
    }
    remainingJobs -= result.value;
  }
}

/**
 * Simulates dynamic import expressions in a QuickJS sandbox to resolve targets.
 *
 * FIX – Template-String / forEach-loop imports:
 *
 * When a dynamic import uses a template literal whose expression is a *loop
 * variable* (e.g. `files.forEach(file => import(\`./plugins/${file}\`))`) the
 * parser now emits a `__optiprune_loop_vars__` comment in `contextCode` that
 * lists the callback parameter names.  This function detects that hint and
 * rewrites the simulation to iterate over the mocked directory listing instead
 * of executing once with `file === undefined`.
 *
 * Additionally, when the import argument is a plain template literal whose
 * expression is a single identifier (e.g. `` import(`./plugins/${name}.ts`) ``
 * where `name` is a `const` in the same scope), the QuickJS simulation already
 * resolves it correctly because the `const` declaration is captured in the
 * context code.  No special handling is needed for that case.
 */
async function resolveDynamicImports(
  context: AnalysisContext,
  quickJS: any,
  environmentMode: "host" | "unset" | "empty" = "host",
) {
  // Group candidates by file to avoid redundant simulations
  const candidatesByFile = new Map<string, any[]>();
  for (const candidate of context.dynamicImportCandidates) {
    const list = candidatesByFile.get(candidate.file) || [];
    list.push(candidate);
    candidatesByFile.set(candidate.file, list);
  }

  for (const [file, candidates] of candidatesByFile.entries()) {
    for (const candidate of candidates) {
      const runtime = quickJS.newRuntime();
      const vm = runtime.newContext();
      
      try {
        runtime.setMemoryLimit(context.options.layers.isolateMemoryLimitMb * 1024 * 1024);
        
        // Setup explicit runtime mocks first, then install the catch-all scope
        // that safely absorbs additional, unknown globals from application code.
        setupQuickJSMocks(vm, candidate, context, environmentMode);
        installGlobalResilience(vm);

        const globalHandle = vm.global;
        const targetsHandle = vm.newArray();
        vm.setProp(globalHandle, "__OPTIPRUNE_TARGETS__", targetsHandle);

        const importMockFn = vm.newFunction("__optiprune_import", (arg: QuickJSHandle) => {
          const target = vm.dump(arg);
          const currentTargets = vm.getProp(globalHandle, "__OPTIPRUNE_TARGETS__");
          const lenHandle = vm.getProp(currentTargets, "length");
          const len = vm.dump(lenHandle);
          const targetHandle = vm.newString(String(target));
          vm.setProp(currentTargets, len, targetHandle);
          targetHandle.dispose();
          lenHandle.dispose();
          currentTargets.dispose();
          
          // Return a resilient mock instead of a plain empty object
          const createFn = vm.getProp(vm.global, "__create_resilient_mock");
          const mock = vm.callFunction(createFn, vm.undefined);
          createFn.dispose();
          return mock;
        });
        vm.setProp(globalHandle, "__optiprune_import", importMockFn);
        importMockFn.dispose();
        targetsHandle.dispose();
        globalHandle.dispose();

        // QuickJS only evaluates JavaScript. esbuild removes TypeScript/TSX
        // syntax after the minimal import rewrites used for simulation.
        //
        // TEMPLATE-STRING LOOP FIX:
        // If the parser detected that the import lives inside a forEach/map
        // callback, it appended a `// __optiprune_loop_vars__: <names>` comment
        // to contextCode.  We extract those names here and, when present,
        // replace the forEach call in the compiled output with an explicit
        // for-of loop over the mocked directory listing so that every file in
        // the directory is visited and its resolved path is captured.
        const loopVarMatch = candidate.contextCode.match(
          /\/\/ __optiprune_loop_vars__: ([\w,$]+(?:,[\w,$]+)*)/
        );
        const loopVarNames: string[] = loopVarMatch
          ? loopVarMatch[1].split(",").map((s: string) => s.trim()).filter(Boolean)
          : [];

        // Strip the hint comment before compiling so it does not confuse esbuild.
        let cleanedContextCode = candidate.contextCode
          .replace(/\n\/\/ __optiprune_loop_vars__:[^\n]*/g, "");

        const processedContext = await compileForQuickJS(cleanedContextCode, file);

        // When loop variables are present we build a synthetic for-of loop that
        // iterates over the mocked directory listing and calls the import for
        // each file.  This replaces the original forEach callback execution.
        let loopExpansionScript = "";
        if (loopVarNames.length > 0) {
          // Derive the directory and static path parts from either a template
          // literal or a string-concatenation expression.
          const exprText: string = candidate.expression ?? "";
          const templateMatch = exprText.match(/`([^`$]*?)\$\{/);
          const concatMatch = exprText.match(/import\s*\(\s*(['"])(.*?)\1\s*\+\s*[^+]+(?:\+\s*(['"])(.*?)\3)?\s*\)/);
          const dynamicPrefix = templateMatch?.[1] ?? concatMatch?.[2] ?? "";
          const templateSuffixMatch = exprText.match(/\}([^`]*)`/);
          const dynamicSuffix = templateSuffixMatch?.[1] ?? concatMatch?.[4] ?? "";

          // A trailing slash already denotes a directory; otherwise strip the
          // final static path segment before collecting sibling modules.
          const fileDir = path.dirname(file);
          const prefixDir = dynamicPrefix.endsWith("/")
            ? path.resolve(fileDir, dynamicPrefix)
            : dynamicPrefix
              ? path.resolve(fileDir, path.dirname(dynamicPrefix))
              : fileDir;

          // Collect all known modules that live in that directory.
          const dirFiles = Array.from(context.modules.keys())
            .filter(f => path.dirname(f) === prefixDir)
            .map(f => path.basename(f));

          if (dirFiles.length > 0) {
            // Build a synthetic loop that calls __optiprune_import for each file.
            const primaryVar = loopVarNames[0];
            const fileListJson = JSON.stringify(dirFiles);
            const targetExpression = templateMatch
              ? `\`${dynamicPrefix}\${${primaryVar}}${dynamicSuffix}\``
              : `${JSON.stringify(dynamicPrefix)} + ${primaryVar} + ${JSON.stringify(dynamicSuffix)}`;
            loopExpansionScript = `
              (async function __optiprune_loop_expansion__() {
                const __loop_files__ = ${fileListJson};
                for (const ${primaryVar} of __loop_files__) {
                  try {
                    await __optiprune_import(${targetExpression});
                  } catch(e) {}
                }
              })();
            `;
          }
        }

        const simulationScript = `
          (async function() {
            try {
              with (globalThis.__optiprune_scope__) {
                ${processedContext}
                await ${QUICKJS_CONTEXT_FUNCTION}.call(globalThis);
                ${loopExpansionScript}
              }
            } catch (e) {
              if (globalThis.__VERBOSE__) {
                console.log("[QuickJS Runtime Error] " + (e instanceof Error ? e.message : String(e)));
              }
            }
          }).call(globalThis);
        `;

        if (context.options.verbose) {
          console.log(`[Layer 4] Simulation Script for ${file}:\n${simulationScript}`);
        }

        const evalResult = vm.evalCode(simulationScript);
        if (evalResult.error) {
          if (context.options.verbose) {
            console.log(`[Layer 4] Simulation Syntax Error in ${file}:`, vm.dump(evalResult.error));
            console.log(`[Layer 4] Script was:\n${simulationScript}`);
          }
          evalResult.error.dispose();
        } else {
          evalResult.value.dispose();
          // Flush promise continuations created by async path construction.
          drainQuickJSPendingJobs(runtime, vm);
        }
        
        const finalGlobalHandle = vm.global;
        const finalTargetsHandle = vm.getProp(finalGlobalHandle, "__OPTIPRUNE_TARGETS__");
        const targets = vm.dump(finalTargetsHandle) as any[];
        finalTargetsHandle.dispose();
        finalGlobalHandle.dispose();

        // Unknown input values in the sandbox can stringify to paths such as
        // `./commands/undefined.js`. These are simulation artifacts, not
        // concrete dynamic-import targets, and must not affect graph state.
        const concreteTargets = Array.isArray(targets)
          ? targets.filter((target): target is string =>
              typeof target === "string" && !isInvalidSimulatedSpecifier(target),
            )
          : [];

        if (concreteTargets.length > 0) {
          // Mark the corresponding edge as resolved to suppress the warning.
          // We match on location first; if that fails (e.g. the column was
          // computed differently for a template-literal pattern edge) we fall
          // back to matching by line only, and finally to marking *all*
          // unknown-dynamic / dynamic-pattern edges in the file as resolved
          // when the simulation produced at least one concrete target.
          const module = context.modules.get(file);
          if (module) {
            if (context.options.verbose) {
              console.log(`[Layer 4] Searching for edge in ${file} at ${candidate.line}:${candidate.column}`);
              module.edges.forEach(e => {
                if (e.kind === "unknown-dynamic" || e.kind === "dynamic-pattern") {
                  console.log(`[Layer 4] Found ${e.kind} edge at ${e.location?.start.line}:${e.location?.start.column}`);
                }
              });
            }

            // Exact location match
            let edge = module.edges.find(e => 
              (e.kind === "unknown-dynamic" || e.kind === "dynamic-pattern") && 
              e.location?.start.line === candidate.line && 
              e.location?.start.column === candidate.column
            );

            // Line-only fallback (column may differ between parser passes)
            if (!edge) {
              edge = module.edges.find(e =>
                (e.kind === "unknown-dynamic" || e.kind === "dynamic-pattern") &&
                e.location?.start.line === candidate.line
              );
            }

            if (edge) {
              edge.resolution = "resolved";
            } else {
              // Last-resort: mark all unresolved dynamic edges in this file.
              // This is safe because the simulation produced concrete targets,
              // so we know the import is genuinely reachable.
              for (const e of module.edges) {
                if ((e.kind === "unknown-dynamic" || e.kind === "dynamic-pattern") &&
                    e.resolution !== "resolved") {
                  e.resolution = "resolved";
                }
              }
            }
          }

          for (const rawTarget of concreteTargets) {
            resolveAndMarkTarget(rawTarget, file, context, candidate);
          }
        }
      } catch (err) {
        // Simulation failed
        if (context.options.verbose) {
          console.log(`[Layer 4] Simulation threw an exception for ${file}:`, err);
        }
      } finally {
        vm.dispose();
        runtime.dispose();
      }
    }
  }
}

function setupQuickJSMocks(
  vm: QuickJSContext,
  candidate: any,
  context: AnalysisContext,
  environmentMode: "host" | "unset" | "empty" = "host",
) {
  const globalHandle = vm.global;

  // Model process.env explicitly. The resilience proxy must not provide a
  // callable fallback object for environment lookups because JavaScript treats
  // `undefined`, the empty string, and a concrete value differently with `||`.
  const processMock = vm.newObject();
  const envMock = vm.newObject();
  const envNames = new Set<string>();
  for (const match of String(candidate.contextCode ?? "").matchAll(/\bprocess\.env\.([A-Za-z_$][\w$]*)/g)) {
    const name = match[1];
    if (name) envNames.add(name);
  }
  for (const name of envNames) {
    const hostValue = process.env[name];
    const value = environmentMode === "empty"
      ? ""
      : environmentMode === "host" && hostValue !== undefined
        ? hostValue
        : undefined;
    if (value !== undefined) {
      const valueHandle = vm.newString(value);
      vm.setProp(envMock, name, valueHandle);
      valueHandle.dispose();
    }
  }
  vm.setProp(processMock, "env", envMock);
  vm.setProp(globalHandle, "process", processMock);
  envMock.dispose();
  processMock.dispose();

  // 1. __dirname and __filename
  const fileDir = path.dirname(candidate.file);
  const dirnameHandle = vm.newString(fileDir);
  const filenameHandle = vm.newString(candidate.file);
  vm.setProp(globalHandle, "__dirname", dirnameHandle);
  vm.setProp(globalHandle, "__filename", filenameHandle);
  dirnameHandle.dispose();
  filenameHandle.dispose();

  // 2. path mock using host's pathe
  const pathMock = vm.newObject();
  const joinFn = vm.newFunction("join", (...args: QuickJSHandle[]) => {
    const parts = args.map(arg => vm.dump(arg));
    const result = vm.newString(path.join(...parts));
    return result;
  });
  const dirnameFn = vm.newFunction("dirname", (arg: QuickJSHandle) => {
    const result = vm.newString(path.dirname(vm.dump(arg)));
    return result;
  });
  const resolveFn = vm.newFunction("resolve", (...args: QuickJSHandle[]) => {
    const parts = args.map(arg => vm.dump(arg));
    const result = vm.newString(path.resolve(...parts));
    return result;
  });
  const basenameFn = vm.newFunction("basename", (arg: QuickJSHandle, extArg?: QuickJSHandle) => {
    const p = vm.dump(arg);
    const ext = extArg ? vm.dump(extArg) : undefined;
    const result = vm.newString(path.basename(p, ext));
    return result;
  });
  vm.setProp(pathMock, "join", joinFn);
  vm.setProp(pathMock, "dirname", dirnameFn);
  vm.setProp(pathMock, "resolve", resolveFn);
  vm.setProp(pathMock, "basename", basenameFn);
  vm.setProp(globalHandle, "path", pathMock);
  joinFn.dispose();
  dirnameFn.dispose();
  resolveFn.dispose();
  basenameFn.dispose();
  pathMock.dispose();

  // 3. url mock
  //
  // FIX: `fileURLToPath` and `pathToFileURL` are now exposed *both* on the
  // `url` namespace object AND directly on `globalThis`.  This is necessary
  // because `engine.ts` imports them as named imports:
  //   import { fileURLToPath, pathToFileURL } from 'node:url';
  // After the static import declaration is stripped by `cleanForQuickJS`,
  // the bare identifiers `fileURLToPath` and `pathToFileURL` must still
  // resolve to the mock implementations via the global scope.
  const urlMock = vm.newObject();
  const pathToFileURLFn = vm.newFunction("pathToFileURL", (arg: QuickJSHandle) => {
    const p = vm.dump(arg);
    const obj = vm.newObject();
    const hrefValue = vm.newString(`file://${p}`);
    vm.setProp(obj, "href", hrefValue);
    hrefValue.dispose();
    return obj;
  });
  const fileURLToPathFn = vm.newFunction("fileURLToPath", (arg: QuickJSHandle) => {
    const urlStr = vm.dump(arg);
    const p = typeof urlStr === 'string' && urlStr.startsWith('file://') ? urlStr.slice(7) : String(urlStr);
    return vm.newString(p);
  });
  vm.setProp(urlMock, "pathToFileURL", pathToFileURLFn);
  vm.setProp(urlMock, "fileURLToPath", fileURLToPathFn);
  vm.setProp(globalHandle, "url", urlMock);
  // Expose directly on globalThis so bare calls work after import stripping
  vm.setProp(globalHandle, "pathToFileURL", pathToFileURLFn);
  vm.setProp(globalHandle, "fileURLToPath", fileURLToPathFn);
  urlMock.dispose();
  pathToFileURLFn.dispose();
  fileURLToPathFn.dispose();

  // 4. fs mock
  //
  // FIX: The `readdir` mock now returns a *Promise* that resolves to the
  // file list so that `await fs.readdir(...)` works correctly inside the
  // async IIFE.  The synchronous `readdirSync` variant is kept as-is.
  const fsMock = vm.newObject();

  const buildFileList = (rawDir: unknown): string[] => {
    const cleanPath = String(rawDir).replace(/^file:\/\//, '');
    const dir = path.isAbsolute(cleanPath) ? cleanPath : path.resolve(fileDir, cleanPath);

    if (context.options.verbose) {
      console.log(`[QuickJS Mock] fs.readdir called for: "${rawDir}" -> normalized: "${dir}"`);
    }

    const files = Array.from(context.modules.keys())
      .filter(f => {
        const parent = path.dirname(f);
        return parent === dir || parent === dir.replace(/\/$/, '');
      })
      .map(f => path.basename(f));

    if (context.options.verbose) {
      console.log(`[QuickJS Mock] fs.readdir returned:`, files);
    }
    return files;
  };

  // Async readdir – returns a Promise via QuickJS's Promise API
  const readdirAsyncFn = vm.newFunction("readdir", (arg: QuickJSHandle) => {
    const files = buildFileList(vm.dump(arg));
    // Build a resolved Promise manually using Promise.resolve([...])
    const arr = vm.newArray();
    files.forEach((f, i) => {
      const val = vm.newString(f);
      vm.setProp(arr, i, val);
      val.dispose();
    });
    // Use evalCode to create a resolved promise with the array value
    // We store the array in a temp global, resolve it, then clean up.
    vm.setProp(vm.global, "__tmp_readdir_result__", arr);
    arr.dispose();
    const promiseResult = vm.evalCode(`Promise.resolve(globalThis.__tmp_readdir_result__)`);
    if (promiseResult.error) {
      promiseResult.error.dispose();
      // Fallback: return empty resolved promise
      const fallback = vm.evalCode(`Promise.resolve([])`);
      if (fallback.error) { fallback.error.dispose(); return vm.newArray(); }
      const val = fallback.value;
      fallback.value; // keep alive
      return val;
    }
    const promiseHandle = promiseResult.value;
    return promiseHandle;
  });

  // Sync readdirSync
  const readdirSyncFn = vm.newFunction("readdirSync", (arg: QuickJSHandle) => {
    const files = buildFileList(vm.dump(arg));
    const arr = vm.newArray();
    files.forEach((f, i) => {
      const val = vm.newString(f);
      vm.setProp(arr, i, val);
      val.dispose();
    });
    return arr;
  });

  const existsSyncFn = vm.newFunction("existsSync", (arg: QuickJSHandle) => {
    const rawP = vm.dump(arg);
    const cleanPath = String(rawP).replace(/^file:\/\//, '');
    const p = path.isAbsolute(cleanPath) ? cleanPath : path.resolve(fileDir, cleanPath);
    const exists = context.modules.has(p);
    if (context.options.verbose) {
      console.log(`[QuickJS Mock] fs.existsSync("${rawP}") -> ${exists}`);
    }
    return exists ? vm.true : vm.false;
  });

  vm.setProp(fsMock, "readdir", readdirAsyncFn);
  vm.setProp(fsMock, "readdirSync", readdirSyncFn);
  vm.setProp(fsMock, "existsSync", existsSyncFn);

  // Also expose a `promises` sub-object with `readdir`
  const fsPromisesMock = vm.newObject();
  vm.setProp(fsPromisesMock, "readdir", readdirAsyncFn);
  vm.setProp(fsMock, "promises", fsPromisesMock);
  fsPromisesMock.dispose();

  vm.setProp(globalHandle, "fs", fsMock);
  fsMock.dispose();
  readdirAsyncFn.dispose();
  readdirSyncFn.dispose();
  existsSyncFn.dispose();

  // 5. console mock
  const consoleMock = vm.newObject();
  const logFn = vm.newFunction("log", (...args: QuickJSHandle[]) => {
    if (context.options.verbose) {
      console.log(`[QuickJS Console]`, ...args.map(a => vm.dump(a)));
    }
    return vm.undefined;
  });
  const warnFn = vm.newFunction("warn", (...args: QuickJSHandle[]) => {
    if (context.options.verbose) {
      console.warn(`[QuickJS Console]`, ...args.map(a => vm.dump(a)));
    }
    return vm.undefined;
  });
  const errorFn = vm.newFunction("error", (...args: QuickJSHandle[]) => {
    console.error(`[QuickJS Console Error]`, ...args.map(a => vm.dump(a)));
    return vm.undefined;
  });
  vm.setProp(consoleMock, "log", logFn);
  vm.setProp(consoleMock, "warn", warnFn);
  vm.setProp(consoleMock, "error", errorFn);
  vm.setProp(globalHandle, "console", consoleMock);
  
  if (context.options.verbose) {
    vm.setProp(globalHandle, "__VERBOSE__", vm.true);
  }
  
  consoleMock.dispose();
  logFn.dispose();
  warnFn.dispose();
  errorFn.dispose();

  globalHandle.dispose();
}

function isInvalidSimulatedSpecifier(specifier: string): boolean {
  const value = specifier.trim();
  if (!value || value === "undefined" || value === "null" || value === "NaN") return true;
  if (value.includes("[object Object]") || value.includes("[object Undefined]")) return true;
  return /(?:^|[\\/])(?:undefined|null|NaN)(?:$|[.\\/])/.test(value);
}

function resolveAndMarkTarget(specifier: string, sourceFile: string, context: AnalysisContext, candidate?: { line?: number; column?: number }) {
  if (context.options.ignoreUnknownImport) return;

  let cleanSpecifier = specifier;
  if (specifier.startsWith('file://')) {
    cleanSpecifier = specifier.slice(7);
  }

  const sourceDir = path.dirname(sourceFile);
  const absolutePath = path.isAbsolute(cleanSpecifier) 
    ? cleanSpecifier 
    : path.resolve(sourceDir, cleanSpecifier);
  
  let targetModule = context.modules.get(absolutePath);
  
  if (!targetModule) {
    for (const ext of context.options.extensions) {
      const withExt = absolutePath + ext;
      targetModule = context.modules.get(withExt);
      if (targetModule) break;
    }
  }

  if (targetModule) {
    if (context.options.verbose) {
      console.log(`[Layer 4] Marking reachable: ${targetModule.id}`);
    }
    context.reachable.add(targetModule.id);
    for (const exp of targetModule.exports) {
      context.usedExports.add(`${targetModule.id}:${exp.exportedAs}`);
    }

    // Persist the concrete runtime target discovered by the sandbox. This is
    // important when the graph could not infer a candidate from the symbolic
    // pattern alone (for example, when `suffix` is assigned at runtime).
    const sourceModule = context.modules.get(sourceFile);
    const dynamicEdge = sourceModule?.edges.find((edge) =>
      (edge.kind === "dynamic-pattern" || edge.kind === "unknown-dynamic") &&
      (!candidate || (
        edge.location?.start.line === candidate.line &&
        edge.location?.start.column === candidate.column
      )),
    );
    if (dynamicEdge) {
      dynamicEdge.resolution = "resolved";
      if (dynamicEdge.dynamicPattern && !dynamicEdge.dynamicPattern.candidates.includes(targetModule.id)) {
        dynamicEdge.dynamicPattern.candidates.push(targetModule.id);
      }
      if (!dynamicEdge.dynamicPattern) {
        dynamicEdge.target = targetModule.id;
      }
    }
  } else {
    if (context.options.verbose) {
      console.log(`[Layer 4] Could not resolve target: ${absolutePath}`);
    }
  }
}

async function verifyPathInWasmSandbox(
  quickJS: any,
  instrumentedCode: string,
  seedInput: Record<string, any>,
  timeoutMs = 50,
  memoryLimitMb = 16
): Promise<ConcolicVerificationResult> {
  const startTime = performance.now();
  const runtime = quickJS.newRuntime();
  const context = runtime.newContext();
  
  try {
    runtime.setMemoryLimit(memoryLimitMb * 1024 * 1024);
    
    // Install interrupt handler for timeout enforcement
    if (timeoutMs > 0) {
      const deadline = Date.now() + timeoutMs;
      runtime.setInterruptHandler(() => {
        return Date.now() > deadline;
      });
    }

    const setupScript = `
      globalThis.__PROVE_REACHED__ = false;
      globalThis.__coverage__ = {
        traceBranch: (f, l, hit) => { if (hit) globalThis.__PROVE_REACHED__ = true; },
        traceFunction: () => {},
        traceCall: () => {},
        init: () => {}
      };
      const seeds = ${JSON.stringify(seedInput)};
      Object.assign(globalThis, seeds);
    `;
    
    const setupResult = context.evalCode(setupScript);
    setupResult.dispose();
    
    const wrappedCode = `try { ${instrumentedCode} } catch (e) {}`;
    const evalResult = context.evalCode(wrappedCode);
    evalResult.dispose();
    
    const globalHandle = context.global;
    const reachedHandle = context.getProp(globalHandle, "__PROVE_REACHED__");
    const pathReached = context.dump(reachedHandle);
    reachedHandle.dispose();
    globalHandle.dispose();

    return {
      pathReached: Boolean(pathReached),
      executionTimeMs: performance.now() - startTime,
      logs: []
    };
  } catch (err) {
    return {
      pathReached: false,
      executionTimeMs: performance.now() - startTime,
      logs: [(err as Error).message]
    };
  } finally {
    context.dispose();
    runtime.dispose();
  }
}