import { app } from 'electron'
import { NsisUpdater } from 'electron-updater'
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'
import { resolveGitHubUrl } from '@shared/constants'
import type { UpdateCheckResult, UpdateEvent } from '@shared/types'
import type { SettingsService } from './settings.service'
import { checkLatestRelease, isNewerVersion } from './update-checker'

const REPOSITORY_URL = 'https://github.com/vfanlee/vfan-tv'
const RELEASE_DOWNLOAD_BASE_URL = `${REPOSITORY_URL}/releases/latest/download/`

type UpdateEventEmitter = (event: UpdateEvent) => void

export class UpdateService {
  private lastResult?: UpdateCheckResult
  private updater?: NsisUpdater

  constructor(
    private readonly settingsService: SettingsService,
    private readonly emitEvent: UpdateEventEmitter,
  ) {}

  getCurrentVersion(): string {
    return app.getVersion()
  }

  async check(): Promise<UpdateCheckResult> {
    this.emitEvent({ status: 'checking' })

    if (!this.canUseAutoUpdater()) {
      const result = await this.checkManualRelease()
      this.lastResult = result
      this.emitEvent({ result, status: result.updateAvailable ? 'available' : 'not-available' })
      return result
    }

    try {
      const updateCheckResult = await this.configureUpdater().checkForUpdates()
      const updateInfo = updateCheckResult?.updateInfo
      const updateAvailable =
        updateCheckResult?.isUpdateAvailable ??
        (updateInfo ? isNewerVersion(updateInfo.version, this.getCurrentVersion()) : false)

      const manualResult = updateAvailable ? await this.checkManualRelease().catch(() => undefined) : undefined
      const result = this.createResultFromUpdateInfo(updateInfo, updateAvailable, manualResult)

      this.lastResult = result
      this.emitEvent({ result, status: updateAvailable ? 'available' : 'not-available' })
      return result
    } catch (error) {
      const message = getErrorMessage(error)
      const fallback = await this.checkManualRelease().catch(() => undefined)

      if (!fallback) {
        this.emitEvent({ message, status: 'error' })
        throw error
      }

      const result: UpdateCheckResult = {
        ...fallback,
        autoUpdateError: message,
        canAutoUpdate: false,
        status: fallback.updateAvailable ? 'available' : 'not-available',
      }

      this.lastResult = result
      this.emitEvent({ result, status: result.updateAvailable ? 'available' : 'not-available' })
      this.emitEvent({ message, result, status: 'error' })
      return result
    }
  }

  async download(): Promise<void> {
    if (!this.canUseAutoUpdater()) {
      throw new Error('当前平台不支持自动下载更新')
    }

    await this.configureUpdater().downloadUpdate()
  }

  install(): void {
    if (!this.canUseAutoUpdater()) {
      throw new Error('当前平台不支持自动安装更新')
    }

    this.configureUpdater().quitAndInstall(false, true)
  }

  private canUseAutoUpdater(): boolean {
    return process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_DIR
  }

  private configureUpdater(): NsisUpdater {
    const settings = this.settingsService.get()
    const feedUrl = resolveGitHubUrl(RELEASE_DOWNLOAD_BASE_URL, settings)
    const updater = this.getUpdater()

    updater.setFeedURL({ provider: 'generic', url: feedUrl })
    return updater
  }

  private getUpdater(): NsisUpdater {
    if (this.updater) return this.updater

    const updater = new NsisUpdater({ provider: 'generic', url: RELEASE_DOWNLOAD_BASE_URL })
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.disableWebInstaller = true
    updater.on('checking-for-update', () => this.emitEvent({ status: 'checking' }))
    updater.on('download-progress', (progress) => this.emitProgress(progress))
    updater.on('update-downloaded', (event) => this.handleUpdateDownloaded(event))
    updater.on('error', (error) => this.emitEvent({ message: getErrorMessage(error), status: 'error' }))

    this.updater = updater
    return updater
  }

  private emitProgress(progress: ProgressInfo): void {
    this.emitEvent({
      progress: {
        bytesPerSecond: progress.bytesPerSecond,
        percent: progress.percent,
        total: progress.total,
        transferred: progress.transferred,
      },
      status: 'download-progress',
    })
  }

  private handleUpdateDownloaded(event: UpdateDownloadedEvent): void {
    const result = this.createResultFromUpdateInfo(event, true, this.lastResult)
    const downloadedResult: UpdateCheckResult = {
      ...result,
      status: 'downloaded',
    }
    this.emitEvent({ result: downloadedResult, status: 'downloaded' })
  }

  private createResultFromUpdateInfo(
    updateInfo: UpdateInfo | undefined,
    updateAvailable: boolean,
    manualResult?: UpdateCheckResult,
  ): UpdateCheckResult {
    const latestVersion = updateInfo?.version ?? manualResult?.latestVersion ?? this.getCurrentVersion()

    return {
      arch: process.arch,
      canAutoUpdate: this.canUseAutoUpdater() && updateAvailable,
      currentVersion: this.getCurrentVersion(),
      downloadName: manualResult?.downloadName,
      downloadUrl: manualResult?.downloadUrl,
      latestVersion,
      manualDownloadName: manualResult?.manualDownloadName ?? manualResult?.downloadName,
      manualDownloadUrl: manualResult?.manualDownloadUrl ?? manualResult?.downloadUrl,
      platform: process.platform,
      releaseName: normalizeText(updateInfo?.releaseName) ?? manualResult?.releaseName ?? `Vfan TV ${latestVersion}`,
      releaseNotes:
        normalizeReleaseNotes(updateInfo?.releaseNotes) ?? manualResult?.releaseNotes ?? '此版本暂无更新说明。',
      releaseUrl: manualResult?.releaseUrl ?? `${REPOSITORY_URL}/releases/tag/v${latestVersion}`,
      status: updateAvailable ? 'available' : 'not-available',
      updateAvailable,
    }
  }

  private async checkManualRelease(): Promise<UpdateCheckResult> {
    return checkLatestRelease(this.getCurrentVersion(), this.settingsService.get(), process.platform, process.arch)
  }
}

function normalizeReleaseNotes(releaseNotes: UpdateInfo['releaseNotes']): string | undefined {
  if (typeof releaseNotes === 'string') return releaseNotes.trim() || undefined
  if (!Array.isArray(releaseNotes)) return undefined

  const notes = releaseNotes
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object' && 'note' in item && typeof item.note === 'string') return item.note
      return ''
    })
    .filter(Boolean)
    .join('\n\n')

  return notes || undefined
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
