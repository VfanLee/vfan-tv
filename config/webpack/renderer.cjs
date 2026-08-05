const path = require('node:path')
const ReactRefreshWebpackPlugin = require('@pmmmwh/react-refresh-webpack-plugin')
const CommonJsPackagePlugin = require('./commonjs-package-plugin.cjs')

// Forge 不设置 process.env.NODE_ENV，只把构建 mode 传给配置工厂，因此环境判断必须取自 argv。
module.exports = (_env, argv = {}) => {
  const isDevelopment = argv.mode !== 'production'

  return {
    module: {
      rules: require('./rules.cjs')({
        configFile: path.resolve(__dirname, '../../tsconfig.web.json'),
        enableReactRefresh: isDevelopment,
      }),
    },
    resolve: {
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
      alias: {
        '@': path.resolve(__dirname, '../../src/renderer'),
        '@renderer': path.resolve(__dirname, '../../src/renderer'),
        '@shared': path.resolve(__dirname, '../../src/shared'),
      },
    },
    plugins: [new CommonJsPackagePlugin(), ...(isDevelopment ? [new ReactRefreshWebpackPlugin()] : [])],
  }
}
