const pluginName = "angular";
const loaded = await import(`./plugins/${pluginName}-plugin.ts`);
void loaded.AngularPlugin;
