---
title: Continuous integration
description: Keep dead-code checks deterministic and reviewable in CI.
---

Run OptiPrune in report-only mode and fail on the confidence level your team trusts.

```bash
npx optiprune ./src \
  --entry src/index.ts \
  --fail-on high \
  --reporter sarif \
  --output optiprune.sarif
```

Upload the SARIF file to your code-scanning provider or use the JSON reporter for custom build annotations.

## Related pages

- [Configuration](/docs/configuration/)
- [Plugins](/docs/plugins/)
- [Plugin explorer](/plugins)
- [OptiPrune blog](/blog)
