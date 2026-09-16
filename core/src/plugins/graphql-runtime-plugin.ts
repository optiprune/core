import type { AnalyzerPlugin } from "../types.js";

const SOURCE_GLOBS = ["**/*.{ts,tsx,js,jsx,mjs,cjs}"];
const GRAPHQL_WIRING = /(?:GraphQLModule\.forRoot|new\s+ApolloServer|ApolloServer\s*\()/;
const GRAPHQL_EXPORT_USAGE = /\b(?:typeDefs|resolvers|schema)\b/;

export const GraphQLRuntimePlugin: AnalyzerPlugin = {
  name: "graphql-runtime-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    const deps = {
      ...pkg?.dependencies,
      ...pkg?.devDependencies,
      ...pkg?.peerDependencies,
    };
    if (deps.graphql || deps["@nestjs/graphql"] || deps["@apollo/server"]) return true;
    const files = await adapter.findFilesByGlob(SOURCE_GLOBS);
    for (const file of files) {
      const source = await adapter.readFile(file);
      if (source && GRAPHQL_WIRING.test(source)) return true;
    }
    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const files = await adapter.findFilesByGlob(SOURCE_GLOBS);
      let wired = false;
      for (const file of files) {
        const source = await adapter.readFile(file);
        if (!source || !GRAPHQL_WIRING.test(source) || !GRAPHQL_EXPORT_USAGE.test(source)) continue;
        wired = true;
        break;
      }

      // Do not protect raw GraphQL schema/resolver exports merely because the
      // graphql package is installed. They become externally consumed only when
      // a runtime transport actually wires them into Apollo/Nest GraphQL.
      if (wired) {
        adapter.addProtectedExportPatterns(["**/*graphql*.{ts,tsx,js,jsx,mjs,cjs}"]);
      }
    },
  },
};

export default GraphQLRuntimePlugin;
