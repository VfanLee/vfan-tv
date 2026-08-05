module.exports = function createRules({ configFile, enableNativeModules = false, enableReactRefresh = false } = {}) {
  const nativeModuleRules = enableNativeModules
    ? [
        {
          test: /native_modules[/\\].+\.node$/,
          use: 'node-loader',
        },
        {
          test: /[/\\]node_modules[/\\].+\.(m?js|node)$/,
          parser: { amd: false },
          use: {
            loader: '@vercel/webpack-asset-relocator-loader',
            options: {
              outputAssetBase: 'native_modules',
            },
          },
        },
      ]
    : []

  return [
    ...nativeModuleRules,
    {
      test: /\.tsx?$/,
      exclude: /node_modules/,
      use: {
        loader: 'ts-loader',
        options: {
          configFile,
          getCustomTransformers: enableReactRefresh
            ? () => ({ before: [require('react-refresh-typescript')()] })
            : undefined,
          transpileOnly: true,
        },
      },
    },
    {
      test: /\.css$/,
      use: ['style-loader', 'css-loader', 'postcss-loader'],
    },
    {
      test: /\.(png|jpe?g|gif|webp|svg)$/i,
      type: 'asset/resource',
      generator: {
        filename: 'assets/[name].[contenthash:8][ext]',
      },
    },
  ]
}
