class CommonJsPackagePlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap('CommonJsPackagePlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'CommonJsPackagePlugin',
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
        },
        () => {
          compilation.emitAsset(
            'package.json',
            new compiler.webpack.sources.RawSource(`${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`),
          )
        },
      )
    })
  }
}

module.exports = CommonJsPackagePlugin
