const { VueLoaderPlugin } = require('vue-loader');
module.exports = {
  mode: 'production',
  entry: './src/main.js',
  module: { rules: [{ test: /\.vue$/, loader: 'vue-loader' }, { test: /\.js$/, use: 'babel-loader' }] },
  plugins: [new VueLoaderPlugin()],
  resolve: { extensions: ['.js', '.vue'] },
};
