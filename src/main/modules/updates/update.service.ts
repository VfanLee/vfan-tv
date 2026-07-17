import { app } from 'electron'
import { NsisUpdater } from 'electron-updater'
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'
import { resolveGitHubUrl } from '@shared/constants'
import type { UpdateCheckResult, UpdateEvent } from '@shared/types'
import type { SettingsService } from '../settings/settings.service'
import { checkLatestRelease, isNewerVersion } from './update-checker'
import packageJson from '../../../../package.json'

const REPOSITORY_URL = 'https://github.com/vfanlee/vfan-tv'
const RELEASE_DOWNLOAD_BASE_URL = `${REPOSITORY_URL}/releases/latest/download/`

type UpdateEventEmitter = (event: UpdateEvent) => void

// 手动 Release 检查适用于所有平台；Windows 才额外尝试 electron-updater 的下载安装流程。
export class UpdateService {
  private lastResult?: UpdateCheckResult
  private suppressUpdaterErrorEvent = false
  private updater?: NsisUpdater

  constructor(
    private readonly settingsService: SettingsService,
    private readonly emitEvent: UpdateEventEmitter,
  ) {}

  getCurrentVersion(): string {
    return getCurrentVersion()
  }

  async check(): Promise<UpdateCheckResult> {
    this.emitEvent({ status: 'checking' })

    let manualResult: UpdateCheckResult | undefined
    let manualError: unknown

    try {
      manualResult = await this.checkManualRelease()
    } catch (error) {
      manualError = error
    }

    if (manualResult) {
      const result = await this.enrichWithAutoUpdateInfo(manualResult)
      this.lastResult = result
      this.emitEvent({ result, status: result.updateAvailable ? 'available' : 'not-available' })
      return result
    }

    if (!this.canUseAutoUpdater()) {
      const message = getErrorMessage(manualError)
      this.emitEvent({ message, status: 'error' })
      throw manualError
    }

    try {
      const updateCheckResult = await this.checkForUpdatesSilently()
      const updateInfo = updateCheckResult?.updateInfo
      const updateAvailable = isUpdateInfoNewer(updateInfo, this.getCurrentVersion())
      const result = this.createResultFromUpdateInfo(updateInfo, updateAvailable)

      this.lastResult = result
      this.emitEvent({ result, status: updateAvailable ? 'available' : 'not-available' })
      return result
    } catch (error) {
      const message = getErrorMessage(error)
      this.emitEvent({ message, status: 'error' })
      throw error
    }
  }

  async download(): Promise<void> {
    if (!this.canUseAutoUpdater()) {
      throw new Error('当前平台不支持自动下载更新')
    }

    await this.configureUpdater(true).downloadUpdate()
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

  private configureUpdater(useGitHubProxy = false): NsisUpdater {
    const settings = this.settingsService.get()
    const feedUrl = useGitHubProxy ? resolveGitHubUrl(RELEASE_DOWNLOAD_BASE_URL, settings) : RELEASE_DOWNLOAD_BASE_URL
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
    updater.on('error', (error) => {
      if (this.suppressUpdaterErrorEvent) return
      this.emitEvent({ message: getErrorMessage(error), status: 'error' })
    })

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

  private async enrichWithAutoUpdateInfo(manualResult: UpdateCheckResult): Promise<UpdateCheckResult> {
    if (!this.canUseAutoUpdater() || !manualResult.updateAvailable) {
      return {
        ...manualResult,
        canAutoUpdate: false,
      }
    }

    try {
      const updateCheckResult = await this.checkForUpdatesSilently()
      const updateInfo = updateCheckResult?.updateInfo
      const updateAvailable = isUpdateInfoNewer(updateInfo, this.getCurrentVersion())

      if (!updateAvailable) {
        return {
          ...manualResult,
          autoUpdateError: '自动更新元数据未标记此版本可自动安装，请手动下载。',
          canAutoUpdate: false,
        }
      }

      return this.createResultFromUpdateInfo(updateInfo, true, manualResult)
    } catch (error) {
      return {
        ...manualResult,
        autoUpdateError: getErrorMessage(error),
        canAutoUpdate: false,
      }
    }
  }

  private async checkForUpdatesSilently(): ReturnType<NsisUpdater['checkForUpdates']> {
    // 手动检查失败后用于补充元数据的自动检查不应重复向 UI 报错。
    this.suppressUpdaterErrorEvent = true
    try {
      return await this.configureUpdater().checkForUpdates()
    } finally {
      this.suppressUpdaterErrorEvent = false
    }
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

function isUpdateInfoNewer(updateInfo: UpdateInfo | undefined, currentVersion: string): boolean {
  return updateInfo ? isNewerVersion(updateInfo.version, currentVersion) : false
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function getCurrentVersion(): string {
  return packageJson.version || app.getVersion()
}
