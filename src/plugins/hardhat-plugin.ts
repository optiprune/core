import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const HARDHAT_CONFIG_FILES = [
  "hardhat.config.js",
  "hardhat.config.ts",
  "hardhat.config.cjs",
  "hardhat.config.mjs"
];

const HARDHAT_ECOSYSTEM_PACKAGES = [
  "hardhat",
  "@nomicfoundation/hardhat-toolbox",
  "@nomicfoundation/hardhat-network-helpers",
  "@nomicfoundation/hardhat-chai-matchers",
  "@nomicfoundation/hardhat-ethers",
  "@nomicfoundation/hardhat-verify",
  "@nomicfoundation/hardhat-ignition",
  "@nomiclabs/hardhat-ethers",
  "@nomiclabs/hardhat-waffle",
  "@nomiclabs/hardhat-etherscan",
  "hardhat-deploy",
  "hardhat-gas-reporter",
  "solidity-coverage",
  "typechain",
  "@typechain/hardhat"
];

export const HardhatPlugin: AnalyzerPlugin = {
  name: "hardhat-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (HARDHAT_ECOSYSTEM_PACKAGES.some((pkgName) => pkgName in allDeps)) {
        return true;
      }
    }

    for (const configFile of HARDHAT_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return (
      (await adapter.folderExists("contracts")) ||
      (await adapter.folderExists("ignition"))
    );
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

      const hasHardhatDep = HARDHAT_ECOSYSTEM_PACKAGES.some((p) => p in allDeps);

      let hasConfigFile = false;
      for (const configFile of HARDHAT_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
          break;
        }
      }

      // Safeguard all installed Hardhat ecosystem packages in package.json
      // Package manifest presence alone is not usage evidence;
      // config, script, import, and file hooks provide the usage marks.

      // Track npm scripts invoking Hardhat CLI (e.g. "compile": "hardhat compile")
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("hardhat ") || scriptContent === "hardhat")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("hardhat");
          }
        }
      }

      if (hasConfigFile && !hasHardhatDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Hardhat configuration found but 'hardhat' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Configuration files
      if (HARDHAT_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("hardhat");
      }

      // 2. Solidity Contracts, Deployment Scripts, Ignition Modules, Tasks, and Tests
      const hardhatDirectories = [
        "/contracts/",
        "/scripts/",
        "/test/",
        "/tests/",
        "/tasks/",
        "/deploy/",
        "/deployments/",
        "/ignition/"
      ];

      if (hardhatDirectories.some((dir) => normalized.includes(dir))) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("hardhat");
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = HARDHAT_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for Hardhat plugins
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          source === "hardhat" ||
          source.startsWith("@nomicfoundation/hardhat-") ||
          source.startsWith("@nomiclabs/hardhat-") ||
          source.startsWith("hardhat-")
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect CJS require calls for Hardhat plugins: require("@nomicfoundation/hardhat-toolbox")
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (
          t.isStringLiteral(arg) &&
          (arg.value === "hardhat" ||
            arg.value.startsWith("@nomicfoundation/hardhat-") ||
            arg.value.startsWith("@nomiclabs/hardhat-") ||
            arg.value.startsWith("hardhat-"))
        ) {
          adapter.markPackageAsUsed(arg.value);
          adapter.markAsUsed(fileId);
        }
      }

      // 3. Detect Hardhat custom tasks: task("balance", "Prints an account's balance", ...)
      if (
        (isConfigFile || normalized.includes("/tasks/")) &&
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        (node.callee.name === "task" || node.callee.name === "subtask")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("hardhat");
      }

      // 4. Detect default export in hardhat.config.ts/js
      if (isConfigFile && t.isExportDefaultDeclaration(node)) {
        adapter.markAsUsed(fileId, "default");
      }
    }
  }
};

export default HardhatPlugin;