export type Captured = {
  usedFiles: Array<[string, string | undefined]>;
  usedPackages: string[];
  findings: any[];
  projectPatterns: string[];
};

export type CreateAdapterOptions = {
  packageJson?: any;
  configFiles?: string[];
  files?: Record<string, string>;
  rootStorybookDirectory?: boolean;
};

export function createAdapter(options: CreateAdapterOptions = {}) {
  const captured: Captured = {
    usedFiles: [],
    usedPackages: [],
    findings: [],
    projectPatterns: [],
  };

  const adapter = {
    readJson: async (file: string) =>
      file === "package.json" ? (options.packageJson ?? {}) : null,
    readFile: async (file: string) => options.files?.[file] ?? null,
    folderExists: async (file: string) =>
      file === ".storybook" ? !!options.rootStorybookDirectory : !!options.files?.[file],
    findFiles: async (_basenames: string[]) => options.configFiles ?? [],
    markAsUsed: (file: string, symbol?: string) => captured.usedFiles.push([file, symbol]),
    markPackageAsUsed: (packageName: string) => captured.usedPackages.push(packageName),
    emitFinding: (finding: any) => captured.findings.push(finding),
    addProjectPatterns: (patterns: string[]) => captured.projectPatterns.push(...patterns),
  } as any;

  return { adapter, captured };
}