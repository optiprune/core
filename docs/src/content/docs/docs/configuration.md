---
title: Configuration
description: Configure entry points, confidence gates, and plugin overrides.
---

Keep configuration in the repository root so local scans and CI use the same contract.

```json
{
  "entry": ["src/index.ts"],
  "plugins": {
    "nextjs-plugin": true,
    "nestjs-plugin": false
  },
  "failOn": "high"
}
```

## Plugin overrides

Use a plugin name as the key. Set it to `true` to force-enable detection or `false` to disable it even when automatic detection would enable it.

## Confidence thresholds

`failOn: "high"` is a conservative CI default. It blocks only findings with the strongest evidence. Raise the threshold only after reviewing the project’s dynamic behavior and generated artifacts.
