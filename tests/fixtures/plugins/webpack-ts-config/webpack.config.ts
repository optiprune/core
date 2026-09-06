import type { Configuration } from 'webpack';
const config: Configuration = { entry: './src/index.ts', module: { rules: [{ test: /\.ts$/, use: 'ts-loader' }] } };
export default config;
