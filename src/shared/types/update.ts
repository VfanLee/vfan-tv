export type UpdateStatus = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'

export type ReleaseDownloadRouteId = 'direct' | 'gh-proxy' | 'cloudflare-v4' | 'cloudflare-v46' | 'fastly-v4'

export interface UpdateDownloadProgress {
  bytesPerSecond: number
  percent: number
  total: number
  transferred: number
}

export interface UpdateCheckResult {
  arch: string
  autoUpdateError?: string
  canAutoUpdate: boolean
  currentVersion: string
  latestVersion: string
  manualDownloadName?: string
  manualDownloadUrl?: string
  platform: NodeJS.Platform
  releaseName: string
  releaseNotes: string
  releaseUrl: string
  status: UpdateStatus
  updateAvailable: boolean
}

export type UpdateEvent =
  | { status: 'checking' }
  | { result: UpdateCheckResult; status: 'available' | 'not-available' | 'downloaded' }
  | { progress: UpdateDownloadProgress; status: 'download-progress' }
  | { message: string; result?: UpdateCheckResult; status: 'error' }
