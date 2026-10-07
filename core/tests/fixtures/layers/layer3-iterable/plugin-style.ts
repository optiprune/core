declare const adapter: {
  folderExists(path: string): Promise<boolean>;
};

export async function pluginStyle(configFiles: string[], hasDependency: boolean) {
  let hasConfigFile = false;
  for (const configFile of configFiles) {
    if (await adapter.folderExists(configFile)) {
      hasConfigFile = true;
    }
  }
  if (hasConfigFile && !hasDependency) {
    console.log("emit finding");
  }
}
