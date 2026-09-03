---
title: Confidence levels
description: Use evidence strength to decide what to review and remove.
---

Every finding is assigned a confidence level. Confidence is a review aid, not a promise that a project has no dynamic behavior.

| Level  | Meaning                                                 | Recommended action                                |
| ------ | ------------------------------------------------------- | ------------------------------------------------- |
| High   | Strong graph evidence that the item is never reached.   | Review and usually safe to remove.                |
| Medium | Evidence is incomplete or a convention may be involved. | Check runtime behavior and project configuration. |
| Low    | Dynamic or ambiguous behavior limits certainty.         | Keep unless you can prove it is unused.           |

Use `--fail-on high` in CI as a conservative starting point.
