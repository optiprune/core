import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

export const WebpackPlugin: AnalyzerPlugin = {
  name: "webpack-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    return !!(pkg?.devDependencies?.['webpack'] || await adapter.readFile('webpack.config.js'));
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      // Webpack Config selbst ist ein Einstiegspunkt
      if (fileId.includes('webpack.config.')) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // In der Webpack-Config: Suche nach 'entry' Definitionen
      if (fileId.includes('webpack.config.')) {
        if (t.isObjectProperty(node) && t.isIdentifier(node.key) && node.key.name === 'entry') {
          // Wenn entry ein String oder Array von Strings ist, markiere diese als Einstiegspunkte
          const value = node.value;
          if (t.isStringLiteral(value)) {
            adapter.markAsUsed(value.value);
          } else if (t.isObjectExpression(value)) {
            value.properties.forEach(prop => {
              if (t.isObjectProperty(prop) && t.isStringLiteral(prop.value)) {
                adapter.markAsUsed(prop.value.value);
              }
            });
          }
        }
      }
    }
  }
};

export default WebpackPlugin;