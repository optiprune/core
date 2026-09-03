---
title: Output and findings
description: Read terminal, JSON, and SARIF reports with confidence-aware review.
---

OptiPrune emits a structured `AnalysisReport`. It includes the project root, discovered entry points, summary counters, findings, module records, exports, dependency edges, and strongly connected components.

## Formats

The terminal reporter is for humans. JSON preserves the complete report for automation. SARIF 2.1 is intended for code-scanning systems.

```bash
npx @optiprune/cli analyze
npx @optiprune/cli analyze --json > optiprune.json
npx @optiprune/cli analyze --sarif > optiprune.sarif
```

## Finding fields

A finding contains a rule, severity, confidence, message, file information, and optional source location or evidence. Confidence values are `high`, `medium`, `low`, and `info`; severity values are `error`, `warning`, and `info`.

Treat high-confidence findings as the first review queue. Medium and low confidence findings may reflect dynamic imports, runtime contracts, generated files, or incomplete entry-point configuration.
