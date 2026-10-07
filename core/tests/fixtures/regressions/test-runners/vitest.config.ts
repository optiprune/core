import { defineConfig } from "vitest/config";
export default defineConfig({
  root: "packages/app",
  test: {
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.spec.ts"]
  }
});
