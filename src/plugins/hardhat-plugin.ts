import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

const HARDHAT_CONFIG_FILES = ["hardhat.config.js", "hardhat.config.ts"];

export const HardhatPlugin: AnalyzerPlugin = {
  name: "hardhat-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg && (pkg.devDependencies?.["hardhat"] || pkg.dependencies?.["hardhat"])) {
      return true;
    }
    for (const file of HARDHAT_CONFIG_FILES) {
      if ((await adapter.readFile(file)) !== null) return true;
    }
    return false;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const hasHardhat = pkg ? !!(pkg.dependencies?.["hardhat"] || pkg.devDependencies?.["hardhat"]) : false;
      
      let hasConfigFile = false;
      for (const file of HARDHAT_CONFIG_FILES) {
        if ((await adapter.readFile(file)) !== null) {
          hasConfigFile = true;
          break;
        }
      }

      if (hasConfigFile && !hasHardhat) {
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
      const basename = path.basename(fileId);
      if (HARDHAT_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
      // Hardhat Smart Contracts and Scripts
      if (fileId.includes("/contracts/") || fileId.includes("/scripts/") || fileId.includes("/test/")) {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default HardhatPlugin;
