import { getWindowsUpdateChannel } from '../src/shared/constants/update'

/** 应用支持生成安装包的 CPU 架构 */
export const SUPPORTED_BUILD_ARCHITECTURES = ['arm64', 'x64'] as const

/** 应用支持的安装包 CPU 架构 */
export type BuildArchitecture = (typeof SUPPORTED_BUILD_ARCHITECTURES)[number]

/** 解析环境变量、回退值或当前进程架构，并校验其是否受支持 */
export function resolveBuildArchitecture(
  value: string | undefined,
  options: { required?: boolean; fallback?: string } = {},
): BuildArchitecture {
  const candidate = value?.trim() || options.fallback?.trim()

  if (!candidate) {
    if (options.required) throw new Error('VFTV_TARGET_ARCH is required for distributable builds')
    return normalizeBuildArchitecture(process.arch)
  }

  return normalizeBuildArchitecture(candidate)
}

/** 根据目标架构返回 Windows 自动更新渠道 */
export { getWindowsUpdateChannel }

/** 生成包含版本和架构信息的 Windows 安装包文件名 */
export function getWindowsArtifactName(version: string, architecture: BuildArchitecture): string {
  return `vfan-tv-v${version}-${architecture}-setup.exe`
}

/** 生成包含版本和架构信息的 macOS 磁盘映像文件名 */
export function getMacArtifactName(version: string, architecture: BuildArchitecture): string {
  return `vfan-tv-v${version}-${architecture}.dmg`
}

/** 将任意架构字符串收敛为应用支持的构建架构 */
function normalizeBuildArchitecture(value: string): BuildArchitecture {
  if (SUPPORTED_BUILD_ARCHITECTURES.includes(value as BuildArchitecture)) return value as BuildArchitecture
  throw new Error(`Unsupported build architecture: ${value}`)
}
