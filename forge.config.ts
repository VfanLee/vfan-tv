import { cp, mkdir, rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { ForgeConfig, ForgeMakeResult } from '@electron-forge/shared-types'
import { VitePlugin } from '@electron-forge/plugin-vite'
import { FusesPlugin } from '@electron-forge/plugin-fuses'
import { FuseV1Options, FuseVersion } from '@electron/fuses'
import { getMacArtifactName, getWindowsUpdateChannel, resolveBuildArchitecture } from './config/build-targets'
import packageJson from './package.json'

const repository = { owner: 'vfanlee', name: 'vfan-tv' }
const releaseDownloadUrl = 'https://github.com/vfanlee/vfan-tv/releases/latest/download/'
const targetArchitecture = resolveBuildArchitecture(process.env.VFTV_TARGET_ARCH, { fallback: process.arch })
const externalRuntimeDependencies = ['better-sqlite3', 'bindings', 'file-uri-to-path'] as const

const config: ForgeConfig = {
  packagerConfig: {
    appBundleId: 'com.vfanlee.vfan-tv',
    appCategoryType: 'public.app-category.entertainment',
    asar: true,
    executableName: 'Vfan TV',
    extraResource: [resolve('resources/icon.png')],
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
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'config/vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'config/vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'config/vite.renderer.config.ts',
        },
      ],
    }),
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  hooks: {
    packageAfterCopy: async (_forgeConfig, buildPath) => copyExternalRuntimeDependencies(buildPath),
    postMake: async (_forgeConfig, makeResults) => renameMacArtifacts(makeResults),
  },
}

/** 把 Vite external 的运行时依赖复制到 Forge 可重建的应用依赖目录 */
async function copyExternalRuntimeDependencies(buildPath: string): Promise<void> {
  const destinationRoot = join(buildPath, 'node_modules')
  await mkdir(destinationRoot, { recursive: true })
  await Promise.all(
    externalRuntimeDependencies.map((dependency) =>
      cp(resolve('node_modules', dependency), join(destinationRoot, dependency), {
        recursive: true,
        dereference: true,
        force: true,
      }),
    ),
  )
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
