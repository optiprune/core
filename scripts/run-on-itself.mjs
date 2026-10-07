import { analyze } from "./core/dist/index.js";

const report = await analyze({
  rootDir: "./",

  entry: ["core/src/index.ts", "language-server/src/language-server.ts"],

  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue"],

  ignore: [
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/docs/**",
    "**/tests/**",
    "**/test/**",
    "**/fixtures/**",
    "**/__tests__/**",
    "**/*.test.*",
    "**/*.spec.*",
    "**/scripts/**",
  ],

  includeConventionalEntries: false,
  ignoreTests: true,
  reportUnusedExports: false,

  output: "json",
  verbose: false,

  cacheTo: "/tmp/optiprune-self-cache.json",
});

process.stdout.write(JSON.stringify(report, null, 2) + "\n");
