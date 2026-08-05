import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import type { ForgeConfig, ForgeMakeResult } from '@electron-forge/shared-types'
import { getMacArtifactName, getWindowsUpdateChannel, resolveBuildArchitecture } from './config/build-targets'

const require = createRequire(import.meta.url)
const packageJson = require('./package.json') as { version: string }
const repository = { owner: 'vfanlee', name: 'vfan-tv' }
const releaseDownloadUrl = 'https://github.com/vfanlee/vfan-tv/releases/latest/download/'
const targetArchitecture = resolveBuildArchitecture(process.env.VFTV_TARGET_ARCH, { fallback: process.arch })

const config: ForgeConfig = {
  packagerConfig: {
    appBundleId: 'com.vfanlee.vfan-tv',
    appCategoryType: 'public.app-category.entertainment',
    asar: true,
    afterCopy: [markPackagedAppAsCommonJs],
    executableName: 'Vfan TV',
    icon: resolve('build/icon'),
    name: 'Vfan TV',
  },
  rebuildConfig: {
    force: true,
    onlyModules: ['better-sqlite3'],
  },
  makers: [
    {
      name: '@felixrieseberg/electron-forge-maker-nsis',
      platforms: ['win32'],
      config: {
        updater: {
          channel: getWindowsUpdateChannel(targetArchitecture),
          updaterCacheDirName: 'vfan-tv-updater',
          url: releaseDownloadUrl,
        },
        getAppBuilderConfig: () => ({
          appId: 'com.vfanlee.vfan-tv',
          artifactName: 'vfan-tv-v${version}-${arch}-setup.${ext}',
          icon: resolve('build/icon.ico'),
          npmRebuild: false,
          productName: 'Vfan TV',
          win: {
            executableName: 'Vfan TV',
            icon: resolve('build/icon.ico'),
          },
          nsis: {
            allowElevation: true,
            allowToChangeInstallationDirectory: true,
            createDesktopShortcut: true,
            include: resolve('build/installer.nsh'),
            oneClick: false,
            perMachine: false,
            runAfterFinish: true,
            selectPerMachineByDefault: false,
            shortcutName: 'Vfan TV',
            uninstallDisplayName: 'Vfan TV',
          },
        }),
      },
    },
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: {
        icon: resolve('build/icon.icns'),
        overwrite: true,
      },
    },
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        draft: true,
        prerelease: false,
        repository,
      },
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-webpack',
      config: {
        devContentSecurityPolicy:
          "default-src 'self' data:; script-src 'self' 'unsafe-eval' 'unsafe-inline' data:; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http://127.0.0.1:*; connect-src 'self' ws: wss: https: http://127.0.0.1:*; media-src 'self' https: http://127.0.0.1:* blob:; worker-src 'self' blob:",
        mainConfig: './config/webpack/main.cjs',
        renderer: {
          config: './config/webpack/renderer.cjs',
          entryPoints: [
            {
              html: './src/renderer/index.html',
              js: './src/renderer/app/main.tsx',
              name: 'main_window',
              preload: {
                js: './src/preload/index.ts',
              },
            },
          ],
        },
      },
    },
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
  ],
  hooks: {
    postMake: async (_forgeConfig, makeResults) => renameMacArtifacts(makeResults),
  },
}

function markPackagedAppAsCommonJs(
  buildPath: string,
  _electronVersion: string,
  _platform: string,
  _architecture: string,
  callback: (error?: Error | null) => void,
): void {
  updatePackagedModuleType(buildPath).then(
    () => callback(),
    (error: unknown) => callback(error instanceof Error ? error : new Error(String(error))),
  )
}

async function updatePackagedModuleType(buildPath: string): Promise<void> {
  const packageJsonPath = join(buildPath, 'package.json')
  const packagedPackageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as Record<string, unknown>
  packagedPackageJson.type = 'commonjs'
  await writeFile(packageJsonPath, `${JSON.stringify(packagedPackageJson, null, 2)}\n`)
}

async function renameMacArtifacts(makeResults: ForgeMakeResult[]): Promise<ForgeMakeResult[]> {
  return Promise.all(
    makeResults.map(async (result) => {
      if (result.platform !== 'darwin') return result

      const architecture = resolveBuildArchitecture(result.arch, { required: true })
      const artifacts = await Promise.all(
        result.artifacts.map(async (artifact) => {
          if (!artifact.endsWith('.dmg')) return artifact

          const destination = join(dirname(artifact), getMacArtifactName(packageJson.version, architecture))
          if (destination !== artifact) await rename(artifact, destination)
          return destination
        }),
      )

      return { ...result, artifacts }
    }),
  )
}

export default config
