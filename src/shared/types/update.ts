export interface UpdateCheckResult {
  currentVersion: string
  latestVersion: string
  releaseName: string
  releaseNotes: string
  releaseUrl: string
  updateAvailable: boolean
}
