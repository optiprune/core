import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const DOCKER_CONFIG_FILES = [
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
  ".dockerignore"
];

const DOCKER_PACKAGES = [
  "dockerode",
  "docker-compose",
  "@docker/extension-api-client"
];

const COMMON_RUNTIMES = [
  "ts-node",
  "tsx",
  "pm2",
  "bun",
  "nodemon",
  "nest",
  "next"
];

export const DockerPlugin: AnalyzerPlugin = {
  name: "docker-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for Docker configuration files
    for (const configFile of DOCKER_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // Check for Dockerfile variants (e.g. Dockerfile.dev, Dockerfile.prod)
    if (await adapter.folderExists("Dockerfile.dev")) return true;
    if (await adapter.folderExists("Dockerfile.prod")) return true;

    // 2. Check package.json dependencies or scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (Object.keys(allDeps).some((dep) => DOCKER_PACKAGES.includes(dep))) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" &&
              (s.includes("docker ") ||
                s.includes("docker-compose ") ||
                s === "docker")
          )
        ) {
          return true;
        }
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

      // 1. Safeguard installed Docker packages in package.json
      // Package declaration alone is not usage evidence.

      // 2. Protect standalone Docker build and Compose files
      for (const configFile of DOCKER_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Track npm scripts invoking Docker CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("docker ") ||
              scriptContent.includes("docker-compose ") ||
              scriptContent === "docker")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
          }
        }
      }

      // 4. Inspect Dockerfile variants for RUN, CMD, ENTRYPOINT, COPY, and ADD instructions
      const dockerfileVariants = [
        "Dockerfile",
        "Dockerfile.dev",
        "Dockerfile.prod"
      ];

      for (const variant of dockerfileVariants) {
        const dockerfileContent = await adapter.readFile(variant);
        if (dockerfileContent) {
          adapter.markAsUsed(variant);
          parseDockerfileInstructions(dockerfileContent, adapter);
        }
      }

      // 5. Inspect docker-compose.yml / compose.yml for service commands and entrypoints
      for (const composeFile of [
        "docker-compose.yml",
        "docker-compose.yaml",
        "compose.yml",
        "compose.yaml"
      ]) {
        const composeContent = await adapter.readFile(composeFile);
        if (composeContent) {
          parseDockerComposeCommands(composeContent, adapter);
          break;
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect Docker configuration files and Dockerfile variants
      if (
        DOCKER_CONFIG_FILES.includes(basename) ||
        basename.startsWith("Dockerfile.")
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      let source: string | undefined;

      // 1. Detect ESM imports
      if (t.isImportDeclaration(node)) {
        source = node.source.value;
      }

      // 2. Detect CJS require('dockerode')
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (t.isStringLiteral(arg)) {
          source = arg.value;
        }
      }

      if (source && DOCKER_PACKAGES.includes(source)) {
        adapter.markPackageAsUsed(source);
        adapter.markAsUsed(fileId);
      }
    }
  }
};

/**
 * Parses Dockerfile lines for commands (RUN, CMD, ENTRYPOINT) and copied files (COPY, ADD)
 */
function parseDockerfileInstructions(dockerfileStr: string, adapter: any): void {
  const lines = dockerfileStr.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const uppercaseLine = line.toUpperCase();

    // 1. Inspect RUN, CMD, ENTRYPOINT instructions
    if (
      uppercaseLine.startsWith("RUN ") ||
      uppercaseLine.startsWith("CMD ") ||
      uppercaseLine.startsWith("ENTRYPOINT ")
    ) {
      parseCommandString(line, adapter);
    }

    // 2. Inspect COPY and ADD statements (handles flags like --from=builder or --chown=node:node)
    if (uppercaseLine.startsWith("COPY ") || uppercaseLine.startsWith("ADD ")) {
      const parts = line.split(/\s+/).slice(1);
      const sourcePaths = parts.filter((part) => !part.startsWith("--"));

      if (sourcePaths.length > 0 && sourcePaths[0]) {
        // Strip quotes or JSON brackets if array syntax is used (e.g. COPY ["package.json", "./"])
        const cleanPath = sourcePaths[0].replace(/['"[\]]/g, "");
        if (cleanPath && cleanPath !== ".") {
          adapter.markAsUsed(cleanPath);
        }
      }
    }
  }
}

/**
 * Parses docker-compose.yml lines for service command, entrypoint, and Dockerfile references
 */
function parseDockerComposeCommands(composeStr: string, adapter: any): void {
  const lines = composeStr.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    // Detect command: npm run start or entrypoint: ["npm", "run", "start"]
    if (line.startsWith("command:") || line.startsWith("entrypoint:")) {
      parseCommandString(line, adapter);
    }

    // Detect build context or custom dockerfile (e.g., dockerfile: Dockerfile.dev)
    if (line.startsWith("dockerfile:")) {
      const dockerfileName = line.replace(/^dockerfile:\s*/, "").trim();
      if (dockerfileName) {
        adapter.markAsUsed(dockerfileName);
      }
    }
  }
}

/**
 * Parses command strings to extract invoked npm scripts, npx tools, and runtimes
 */
function parseCommandString(cmdLine: string, adapter: any): void {
  // 1. Detect npx invocations: "RUN npx prisma generate" -> "prisma"
  if (cmdLine.includes("npx ")) {
    const parts = cmdLine.split("npx ")[1]?.trim().split(" ");
    const pkgName = parts?.find((p) => !p.startsWith("-"));
    if (pkgName) {
      const cleanPkg = pkgName.replace(/['"[\]]/g, "");
      adapter.markPackageAsUsed(cleanPkg);
    }
  }

  // 2. Detect common CLI runtimes (ts-node, tsx, pm2, etc.)
  for (const runtime of COMMON_RUNTIMES) {
    if (cmdLine.includes(runtime)) {
      adapter.markPackageAsUsed(runtime);
    }
  }

  // 3. Extract npm run / yarn / pnpm / bun script invocations
  if (
    cmdLine.includes("npm run ") ||
    cmdLine.includes("yarn ") ||
    cmdLine.includes("pnpm ") ||
    cmdLine.includes("pnpm run ") ||
    cmdLine.includes("bun run ") ||
    cmdLine.includes("bun ")
  ) {
    const match = cmdLine.match(
      /(?:npm run|yarn|pnpm run|pnpm|bun run|bun)\s+([a-zA-Z0-9_:-]+)/
    );
    if (match && match[1]) {
      const scriptName = match[1].replace(/['"[\]]/g, "");
      if (
        !["test", "build", "install", "run", "add", "start"].includes(
          scriptName
        )
      ) {
        adapter.markAsUsed("package.json", `scripts:${scriptName}`);
      } else if (["test", "build", "start"].includes(scriptName)) {
        adapter.markAsUsed("package.json", `scripts:${scriptName}`);
      }
    }
  }
}

export default DockerPlugin;