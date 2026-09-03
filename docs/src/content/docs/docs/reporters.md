---
title: Reporters
description: Export findings for terminals, automation, and code scanning.
---

The terminal reporter is optimized for humans. JSON is stable for scripts, dashboards, and custom annotations. SARIF is designed for code-scanning integrations.

```bash
npx optiprune ./src --reporter json --output optiprune.json
npx optiprune ./src --reporter sarif --output optiprune.sarif
```

Keep reports as CI artifacts when you need historical comparison. Avoid committing generated reports unless your project intentionally treats them as release evidence.
