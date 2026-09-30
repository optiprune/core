# Reported analysis edge cases

These fixture workspaces preserve the cases supplied with the OptiPrune Core review and the related dynamic-loader/JSX guardrails. The test driver is `core/tests/Functions/reported-edge-cases.test.ts`.

| Fixture | Expected behavior after the fix |
| --- | --- |
| `cases/opaque-dynamic` | Keep the `unknown-dynamic-import` and `unreachable-file` findings, but mark the unreachable finding low confidence because an entry has unknown runtime loading. |
| `cases/shadowed-local` | The local `hidden` inside `f` does not count as a read of the exported `hidden`; report `hidden` as unused. |
| `cases/imported-but-unread` | An unread named import is not evidence that the export is used; report `neverRead` and `trulyUnimported` as unused. |
| `cases/indirect-directory-loader` | A static `resolve(import.meta.dirname, "./module-cache-7f3")` alias passed to `readdir` protects plugin files under that directory from unreachable-file findings. |
| `cases/jsx-component` | A component used as a JSX tag counts as a read of the imported binding; do not report `Button` as unused. |
| `cases/lexical-scope-resolution` | A local self-initializer and a same-named parameter do not count as module-export reads; a function-body local does not shadow an outer reference in a parameter default. |
| `cases/side-effect-import` | The unread `version` export is unused, but the imported module file remains reachable because its dependency edge is retained for top-level side effects. |

The opaque-dynamic case remains inherently ambiguous: a low-confidence finding is intentionally retained rather than treating the analyzer as having proven that the file cannot be loaded.
