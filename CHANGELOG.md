# Changelog

## 1.12.17 Added Dynamic Member Detection

This release prevents false-positive unused-member findings for dynamically imported modules, protects configuration-file members through built-in analysis rules, adds opt-in entry-point member reporting through `includeEntryMembers`, and ensures the WASM QuickJS sandbox runtime dependency is packaged correctly. Regression tests cover all of these behaviors.

