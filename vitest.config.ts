import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30000, // 30 seconds standard timeout for Concolic & SMT runs
    exclude: ["**/node_modules/**", "**/tests/fixtures/**"],
  },
});