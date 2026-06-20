export interface UpdateCheckResult {
  currentVersion: string
  downloadName?: string
  downloadUrl?: string
  latestVersion: string
  releaseName: string
  releaseNotes: string
  releaseUrl: string
  updateAvailable: boolean
}
