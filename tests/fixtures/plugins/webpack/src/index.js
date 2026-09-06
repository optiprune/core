const modules = require.context('./modules', false, /\.js$/);
export const loaded = modules.keys().map((key) => modules(key));
