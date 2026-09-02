---
title: Fixes and safety
description: Apply explicit, confidence-gated changes without losing review control.
---

Fixes are opt-in. Supported targets include files, exports, dependencies, devDependencies, and conditions. Start with a dry run and choose a minimum confidence level.

```bash
npx @optiprune/cli analyze --fix files,exports --confidence medium+ --dry-run
npx @optiprune/cli analyze --fix-json
```

`--force` allows a selected operation to continue when the source edit is considered unsafe. Use it only when the change has been reviewed. In Core integrations, `applyFixes(report, rootDir, fixConfig)` returns the planned or applied change count.
