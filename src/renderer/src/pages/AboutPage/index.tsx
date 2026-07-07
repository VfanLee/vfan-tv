import { useCallback, useEffect, useState } from 'react'
import {
  CircleUserRound,
  Download,
  Lightbulb,
  MessageCircle,
  RefreshCw,
  Rocket,
  SquareArrowOutUpRight,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { FaGithub } from 'react-icons/fa'
import { toast } from 'sonner'
import type { UpdateCheckResult, UpdateDownloadProgress } from '@shared/types'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Card } from '@renderer/components/ui/card'
import logoMarkUrl from '@renderer/assets/logo-mark.svg'
import {
  checkForUpdates,
  downloadUpdate,
  getCurrentVersion,
  installUpdate,
  isApiAvailable,
  onUpdateEvent,
} from '@renderer/services/api'
import { openExternalUrl } from '@renderer/utils/open-external'
import { cn } from '@renderer/utils/cn'

const REPOSITORY_URL = 'https://github.com/vfanlee/vfan-tv'
const AUTHOR_URL = 'https://github.com/vfanlee'
const FEEDBACK_URL = `${REPOSITORY_URL}/issues/new`

interface CheckUpdateOptions {
  force?: boolean
  showToast?: boolean
  shouldApplyResult?: () => boolean
}

export function AboutPage(): React.JSX.Element {
  const [currentVersion, setCurrentVersion] = useState('')
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult>()
  const [isChecking, setIsChecking] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [isUpdateDownloaded, setIsUpdateDownloaded] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<UpdateDownloadProgress>()
  const [lastCheckedAt, setLastCheckedAt] = useState<Date>()
  const apiAvailable = isApiAvailable()

  const handleCheckUpdates = useCallback(
    async ({ showToast = true, shouldApplyResult = () => true }: CheckUpdateOptions = {}): Promise<void> => {
      setIsChecking(true)
      setIsUpdateDownloaded(false)
      setDownloadProgress(undefined)
      try {
        const result = await checkForUpdates()
        if (!shouldApplyResult()) return

        const checkedAt = new Date()
        setUpdateResult(result)
        setLastCheckedAt(checkedAt)
        if (showToast) {
          if (result.updateAvailable) {
            toast.success(`发现新版本 v${result.latestVersion}`)
          } else {
            toast.success('当前已是最新版本')
          }
        }
      } catch (error) {
        if (!shouldApplyResult()) return

        if (showToast) {
          toast.error('检查更新失败', {
            description: error instanceof Error ? error.message : String(error),
          })
        }
      } finally {
        if (shouldApplyResult()) {
          setIsChecking(false)
        }
      }
    },
    [],
  )

  const handleDownloadUpdate = useCallback(async (): Promise<void> => {
    setIsDownloading(true)
    setDownloadProgress(undefined)
    try {
      await downloadUpdate()
    } catch (error) {
      setIsDownloading(false)
      toast.error('下载更新失败', {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [])

  const handleInstallUpdate = useCallback(async (): Promise<void> => {
    try {
      await installUpdate()
    } catch (error) {
      toast.error('安装更新失败', {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [])

  useEffect(() => {
    if (!apiAvailable) return

    let active = true
    const unsubscribe = onUpdateEvent((event) => {
      if (!active) return

      if (event.status === 'checking') {
        setIsChecking(true)
        return
      }

      if (event.status === 'download-progress') {
        setIsDownloading(true)
        setDownloadProgress(event.progress)
        return
      }

      if (event.status === 'available' || event.status === 'not-available') {
        setUpdateResult(event.result)
        setLastCheckedAt(new Date())
        setIsChecking(false)
        return
      }

      if (event.status === 'downloaded') {
        setUpdateResult(event.result)
        setIsDownloading(false)
        setIsUpdateDownloaded(true)
        setDownloadProgress({ bytesPerSecond: 0, percent: 100, total: 0, transferred: 0 })
        toast.success('更新下载完成')
        return
      }

      if (event.status === 'error') {
        setIsChecking(false)
        setIsDownloading(false)
        if (event.result) {
          setUpdateResult(event.result)
        }
      }
    })

    void getCurrentVersion().then((version) => {
      if (!active) return

      setCurrentVersion(version)
      void handleCheckUpdates({ showToast: false, shouldApplyResult: () => active })
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [apiAvailable, handleCheckUpdates])

  return (
    <div className="bg-background text-foreground min-h-full px-10 py-9 pr-24">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <Card className="p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <img alt="Vfan TV" className="size-16 shrink-0" draggable={false} src={logoMarkUrl} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-2xl font-semibold tracking-tight">Vfan TV</h1>
                  <Badge>GPL-3.0</Badge>
                </div>
                <p className="text-muted-foreground mt-1.5 text-sm leading-6">
                  免费开源、开箱即用、跨平台的桌面端影视聚合播放器。
                </p>
              </div>
            </div>
            <ExternalLink href={REPOSITORY_URL} label="GitHub" />
          </div>
          <p className="border-primary/30 bg-primary/5 text-muted-foreground mt-5 border-l-2 px-3 py-2 text-xs leading-5">
            本应用为空壳播放器，不内置数据源或直播源，请自行收集并配置。
          </p>
        </Card>

        <Card className="gap-0 overflow-hidden py-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
            <h2 className="text-lg font-semibold">检查更新</h2>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-muted-foreground text-xs">上次检查时间：{formatLastCheckedAt(lastCheckedAt)}</span>
              <Button
                className="w-full sm:w-auto"
                disabled={!apiAvailable || isChecking}
                variant="outline"
                onClick={() => void handleCheckUpdates({ force: true, showToast: true })}
              >
                {isChecking ? '正在检查' : '检查更新'}
              </Button>
            </div>
          </div>

          <div className="border-border bg-primary/5 text-muted-foreground flex items-center gap-2 border-b px-6 py-3 text-xs">
            <Lightbulb className="text-primary shrink-0" size={16} />
            <span>{getUpdateHint(updateResult, isChecking, isDownloading, isUpdateDownloaded)}</span>
          </div>

          <div className="grid gap-5 p-6 sm:grid-cols-2">
            <VersionItem label="当前版本" value={currentVersion ? `v${currentVersion}` : '读取中'} />
            <VersionItem label="最新版本" value={updateResult ? `v${updateResult.latestVersion}` : '尚未检查'} />
          </div>

          {updateResult?.updateAvailable ? (
            <div className="border-border border-t px-6 py-5">
              <h3 className="text-sm font-semibold">{updateResult.releaseName}</h3>
              {updateResult.manualDownloadUrl || updateResult.canAutoUpdate ? (
                <UpdateOptions
                  downloadProgress={downloadProgress}
                  isDownloaded={isUpdateDownloaded}
                  isDownloading={isDownloading}
                  result={updateResult}
                  onDownload={() => void handleDownloadUpdate()}
                  onInstall={() => void handleInstallUpdate()}
                />
              ) : (
                <button
                  type="button"
                  className="border-border bg-background hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring mt-4 inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2"
                  onClick={() => void openExternalUrl(updateResult.releaseUrl)}
                >
                  前往发布页
                  <SquareArrowOutUpRight className="shrink-0" size={14} />
                </button>
              )}
              <h4 className="mt-4 text-sm font-semibold">更新日志：</h4>
              <p className="text-muted-foreground mt-1.5 max-h-24 overflow-y-auto text-sm leading-6 whitespace-pre-wrap">
                {updateResult.releaseNotes}
              </p>
            </div>
          ) : null}
        </Card>

        <div className="grid gap-5 sm:grid-cols-2">
          <LinkCard href={AUTHOR_URL} icon={CircleUserRound} title="关于作者" />
          <LinkCard href={FEEDBACK_URL} icon={MessageCircle} title="意见反馈" />
        </div>

        <p className="text-muted-foreground text-center text-sm">Copyright © 2026 VfanLee</p>
      </div>
    </div>
  )
}

function UpdateOptions({
  downloadProgress,
  isDownloaded,
  isDownloading,
  result,
  onDownload,
  onInstall,
}: {
  downloadProgress?: UpdateDownloadProgress
  isDownloaded: boolean
  isDownloading: boolean
  result: UpdateCheckResult
  onDownload: () => void
  onInstall: () => void
}): React.JSX.Element {
  const manualDownloadUrl = result.manualDownloadUrl ?? result.downloadUrl
  const fileName = result.manualDownloadName ?? result.downloadName

  return (
    <div className="bg-muted/40 mt-4 rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">更新下载</h4>
        {fileName ? <span className="text-muted-foreground max-w-full truncate text-xs">{fileName}</span> : null}
      </div>

      {result.autoUpdateError ? (
        <p className="text-destructive mt-3 text-xs leading-5">自动更新不可用：{result.autoUpdateError}</p>
      ) : null}

      {downloadProgress ? (
        <div className="mt-3">
          <div className="bg-border h-2 overflow-hidden rounded-full">
            <div
              className="bg-primary h-full rounded-full transition-[width]"
              style={{ width: `${Math.min(100, Math.max(0, downloadProgress.percent))}%` }}
            />
          </div>
          <div className="text-muted-foreground mt-1.5 flex justify-between text-xs">
            <span>{formatPercent(downloadProgress.percent)}</span>
            <span>{formatBytesPerSecond(downloadProgress.bytesPerSecond)}</span>
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-xs leading-5">
          {result.canAutoUpdate
            ? 'Windows 安装版可自动下载并重启安装，也可以手动下载安装包。'
            : '当前平台使用手动下载，链接会套用「设置 / 网络 - GitHub 代理」。'}
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          {result.canAutoUpdate && !isDownloaded ? (
            <Button disabled={isDownloading} size="lg" onClick={onDownload}>
              {isDownloading ? <RefreshCw className="animate-spin" size={16} /> : <Download size={16} />}
              {isDownloading ? '下载中' : '下载更新'}
            </Button>
          ) : null}
          {result.canAutoUpdate && isDownloaded ? (
            <Button size="lg" onClick={onInstall}>
              <Rocket size={16} />
              安装并重启
            </Button>
          ) : null}
          {manualDownloadUrl ? (
            <Button size="lg" variant="outline" onClick={() => void openExternalUrl(manualDownloadUrl)}>
              手动下载
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function VersionItem({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <div className="text-muted-foreground text-xs font-medium">{label}</div>
      <div className="mt-1 text-base font-semibold">{value}</div>
    </div>
  )
}

function getUpdateHint(
  result: UpdateCheckResult | undefined,
  isChecking: boolean,
  isDownloading: boolean,
  isUpdateDownloaded: boolean,
): string {
  if (isChecking) return '正在获取最新版本信息…'
  if (isDownloading) return '正在下载更新包…'
  if (isUpdateDownloaded) return '更新已下载，可重启安装'
  if (!result) return '提示：点击「检查更新」获取最新版本'
  if (result.updateAvailable && result.canAutoUpdate) return `发现新版本 v${result.latestVersion}，可自动下载并安装`
  if (result.updateAvailable) return `发现新版本 v${result.latestVersion}，可查看更新说明并手动下载`
  return '当前已是最新版本'
}

function formatLastCheckedAt(date: Date | undefined): string {
  if (!date) return '尚未检查'

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')

  return `${year}-${month}-${day} ${hour}:${minute}`
}

function formatPercent(percent: number): string {
  return `${Math.round(percent)}%`
}

function formatBytesPerSecond(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return ''

  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`
  }

  return `${Math.max(1, Math.round(bytesPerSecond / 1024))} KB/s`
}

function LinkCard({ href, icon: Icon, title }: { href: string; icon: LucideIcon; title: string }): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'border-border bg-card text-card-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring',
        'flex min-h-20 w-full items-center gap-3 rounded-xl border px-6 text-left shadow-sm transition-colors outline-none focus-visible:ring-2',
      )}
      onClick={() => void openExternalUrl(href)}
    >
      <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-full">
        <Icon size={19} />
      </div>
      <span className="text-lg font-semibold">{title}</span>
      <SquareArrowOutUpRight className="text-muted-foreground ml-auto shrink-0" size={16} />
    </button>
  )
}

function ExternalLink({ href, label }: { href: string; label: string }): React.JSX.Element {
  return (
    <button
      type="button"
      className="border-border hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2"
      onClick={() => void openExternalUrl(href)}
    >
      <FaGithub aria-hidden size={18} />
      {label}
      <SquareArrowOutUpRight size={15} />
    </button>
  )
}
