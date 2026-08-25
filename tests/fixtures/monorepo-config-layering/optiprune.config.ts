export default {
  entry: ["src/index.ts"],
  ignore: ["root-generated/**"],
  ignoreDependencies: ["root-ignored"],
  failOn: "none",
  layers: { skip3: true, skip4: true },
};
