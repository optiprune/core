import { init } from "z3-solver";

interface BranchCoverage {
  file: string;
  line: number;
  condition: any; // The symbolic representation of the condition
  hit: boolean;
}

interface FunctionCoverage {
  file: string;
  line: number;
  name: string;
  hit: boolean;
}

interface CallCoverage {
  file: string;
  line: number;
  callee: string;
  hit: boolean;
}

export class CoverageTracker {
  private branches: Map<string, BranchCoverage> = new Map();
  private functions: Map<string, FunctionCoverage> = new Map();
  private calls: Map<string, CallCoverage> = new Map();
  private currentFile: string = "";
  private z3: any;

  constructor(z3Context: any) {
    this.z3 = z3Context;
  }

  init(file: string) {
    this.currentFile = file;
  }

  traceBranch(file: string, line: number, condition: any) {
    const key = `${file}:${line}`;
    if (!this.branches.has(key)) {
      this.branches.set(key, { file, line, condition, hit: false });
    }
    this.branches.get(key)!.hit = true;
  }

  traceFunction(file: string, line: number, name: string) {
    const key = `${file}:${line}:${name}`;
    if (!this.functions.has(key)) {
      this.functions.set(key, { file, line, name, hit: false });
    }
    this.functions.get(key)!.hit = true;
  }

  traceCall(file: string, line: number, callee: string) {
    const key = `${file}:${line}:${callee}`;
    if (!this.calls.has(key)) {
      this.calls.set(key, { file, line, callee, hit: false });
    }
    this.calls.get(key)!.hit = true;
  }

  // New method to trace and execute calls
  traceAndExecuteCall(
    file: string,
    line: number,
    calleeName: string,
    callee: Function,
    args: any[],
  ) {
    this.traceCall(file, line, calleeName);
    // Execute the original function call
    return callee(...args);
  }

  getCoverage() {
    return {
      branches: Array.from(this.branches.values()),
      functions: Array.from(this.functions.values()),
      calls: Array.from(this.calls.values()),
    };
  }

  reset() {
    this.branches.clear();
    this.functions.clear();
    this.calls.clear();
    this.currentFile = "";
  }
}

// This will be initialized once in Layer 4 and passed to the sandbox
export async function createCoverageTracker() {
  const { Context } = await init();
  const z3 = Context("main");
  return new CoverageTracker(z3);
}
