export default {
  env: { production: { presets: ["@babel/preset-env"], plugins: ["transform-runtime"] } },
  overrides: [{ test: "./src/legacy", plugins: ["@babel/plugin-transform-arrow-functions"] }]
};
