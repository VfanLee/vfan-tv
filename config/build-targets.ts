import { getWindowsUpdateChannel } from '../src/shared/constants/update'

export const SUPPORTED_BUILD_ARCHITECTURES = ['arm64', 'x64'] as const

export type BuildArchitecture = (typeof SUPPORTED_BUILD_ARCHITECTURES)[number]

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

export { getWindowsUpdateChannel }

export function getWindowsArtifactName(version: string, architecture: BuildArchitecture): string {
  return `vfan-tv-v${version}-${architecture}-setup.exe`
}

export function getMacArtifactName(version: string, architecture: BuildArchitecture): string {
  return `vfan-tv-v${version}-${architecture}.dmg`
}

function normalizeBuildArchitecture(value: string): BuildArchitecture {
  if (SUPPORTED_BUILD_ARCHITECTURES.includes(value as BuildArchitecture)) return value as BuildArchitecture
  throw new Error(`Unsupported build architecture: ${value}`)
}
