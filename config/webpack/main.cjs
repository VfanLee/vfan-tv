const path = require('node:path')
const CommonJsPackagePlugin = require('./commonjs-package-plugin.cjs')

module.exports = {
  entry: './src/main/index.ts',
  module: {
    rules: require('./rules.cjs')({
      configFile: path.resolve(__dirname, '../../tsconfig.node.json'),
      enableNativeModules: true,
    }),
  },
  resolve: {
    extensions: ['.js', '.ts', '.tsx', '.json'],
    alias: {
      '@shared': path.resolve(__dirname, '../../src/shared'),
    },
  },
  plugins: [new CommonJsPackagePlugin()],
}
