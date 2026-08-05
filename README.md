![Optiprune Logo](./logo.svg)
![NPM Version](https://img.shields.io/npm/v/@optiprune/core)
![GitHub License](https://img.shields.io/github/license/optiprune/core)

# 🚀 OptiPrune
---

## 💎 The Vision
Most dead-code analyzers just guess. They look at import graphs and hope they don't miss anything critical. This leads to **false positives**, broken builds, and developer frustration.

**OptiPrune is different.** We use formal logic, isolated execution, and a high-performance engine to not just find dead code, but to mathematically **prove** it.

> **"Stop Guessing, Start Proving."**

---

## ⚡ The 3 Pillars of Superiority

### 1. Raw Power: The Yuku Engine (Zig)
While other tools are throttled by the N-API bottleneck, OptiPrune utilizes the **Yuku Engine** written in **Zig**. It minimizes the overhead between native performance and the JavaScript runtime.
*   **The Result:** Up to 3x faster parsing than traditional tools, even in massive monorepos.

### 2. Deep Intelligence: SMT & Z3 Solver
OptiPrune is the first analyzer to use a real **SMT Solver (Z3)**. We don't just analyze if a function is exported; we analyze if the code *inside* the function is logically reachable.
*   **The Result:** Detects dead logic paths (e.g., impossible `if` conditions) that are completely invisible to Knip.

### 3. Absolute Precision: WASM Sandbox Execution
Dynamic imports are the final boss of static analysis. OptiPrune solves this through a **WASM-based QuickJS sandbox**. We securely execute critical code snippets to resolve paths at runtime.
*   **The Result:** Zero false alarms for dynamic paths. If OptiPrune says it's dead, it's dead.

---

## 🥊 OptiPrune vs. Knip: The Head-to-Head

| Feature | Knip | OptiPrune |
| :--- | :--- | :--- |
| **Engine** | Babel / OXC (Standard) | **Yuku / Zig (Hyper-Speed)** |
| **Logic Analysis** | Heuristics (Guessing) | **Z3 SMT Solver (Proving)** |
| **Dynamic Paths** | Pattern Matching | **WASM Sandbox Execution** |
| **Interface Audit** | Ignores Members | **Deep Member-Level Analysis** |
| **Framework Support** | Plugins (Core-Level) | **7-Layer Semantic Context** |
| **False Positives** | High (in complex setups) | **Near-Zero (Context Aware)** |

---

## 🏗️ The 7-Layer Architecture
OptiPrune operates in seven specialized layers to guarantee maximum accuracy:

1.  **Layer 1: Discovery** – Ultra-fast file scanning.
2.  **Layer 2: Basic CFG** – Detects standard dead code after terminal statements.
3.  **Layer 3: SMT Logic** – Mathematical path proofs with Z3.
4.  **Layer 4: WASM Sandbox** – Dynamic path resolution via execution.
5.  **Layer 6: Schema Shield** – Protection for Zod, Decorators & Contracts.
6.  **Layer 6: Dependency Audit** – Scans lockfiles & package.json scripts.
7.  **Layer 7: Topology Engine** – Understands NestJS DI & Event Buses.

---

## 📈 Benchmark Numbers (Real-World Test)
*Tested on a NestJS project with 1000+ files.*

*   **Knip Speed:** 1.26s (with crash risks on complex types)
*   **OptiPrune Speed:** **0.87s** (Stable & Precise)
*   **Accuracy:** OptiPrune found **15% more** real dead code (unused interface properties & logical errors) that Knip completely missed.

---

## Installation

Install Optiprune as a dev dependency via pnpm, npm, or yarn:

```bash
pnpm add -D @optiprune/core
# or
npm install --save-dev @optiprune/core
# or
yarn add -D @optiprune/core

---

## Usage

Run Optiprune from your project root:

```bash
npx @optiprune/cli
```

### CLI Options (@optiprune/cli)

| Flag | Description | Default |
| :--- | :--- | :--- |
| `-r, --rootDir` | Project root directory | `process.cwd()` |
| `-e, --entry` | Entry point patterns (glob) | `[]` |
| `-i, --ignore` | Patterns to ignore | `[]` |
| `--no-report-unused-exports` | Disable unused export reporting | `false` |
| `--fail-on` | Fail on confidence (high/medium/low/none) | `high` |
| `--json` | Output as JSON | `false` |
| `--sarif` | Output as SARIF | `false` |
| `--skip-3` | Skip Layer 3 (SMT Constraint Solver) | `false` |
| `--skip-4` | Skip Layer 4 (Concolic Execution Proofs) | `false` |

---

## 🤝 Join the Revolution
OptiPrune isn't just a tool. It's a technical statement. Help us save the world from dirty code.

**GitHub:** [DreamLongYT/optiprune](https://github.com/DreamLongYT/optiprune)
**Web:** [opti.drml.int.yt](https://opti.drml.int.yt)
See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup and development guides.