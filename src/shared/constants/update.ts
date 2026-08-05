export const UPDATE_CHECK_CACHE_KEY = 'vfan-tv-update-check-cache'

export function getWindowsUpdateChannel(architecture: string): string {
  if (architecture !== 'x64' && architecture !== 'arm64') {
    throw new Error(`Unsupported Windows update architecture: ${architecture}`)
  }

  return `latest-${architecture}`
}
