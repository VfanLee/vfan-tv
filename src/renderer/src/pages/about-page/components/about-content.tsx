import { Download, RefreshCw, Rocket, SquareArrowOutUpRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { FaGithub } from 'react-icons/fa'
import type { UpdateCheckResult, UpdateDownloadProgress } from '@shared/types'
import { Button } from '@/ui/button'
import { cn, openExternalUrl } from '@/utils'
import { formatBytesPerSecond, formatPercent } from '../utils'

export function UpdateOptions({
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
            : '当前平台使用手动下载，安装包下载会套用「设置 / 网络 - GitHub 加速」。'}
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          {result.canAutoUpdate && !isDownloaded ? (
            <Button disabled={isDownloading} size="lg" onClick={onDownload}>
              {isDownloading ? (
                <RefreshCw className="animate-spin" data-icon="inline-start" />
              ) : (
                <Download data-icon="inline-start" />
              )}
              {isDownloading ? '下载中' : '下载更新'}
            </Button>
          ) : null}
          {result.canAutoUpdate && isDownloaded ? (
            <Button size="lg" onClick={onInstall}>
              <Rocket data-icon="inline-start" />
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

export function VersionItem({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <div className="text-muted-foreground text-xs font-medium">{label}</div>
      <div className="mt-1 text-base font-semibold">{value}</div>
    </div>
  )
}

export function LinkCard({
  href,
  icon: Icon,
  title,
}: {
  href: string
  icon: LucideIcon
  title: string
}): React.JSX.Element {
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

export function ExternalLink({ href, label }: { href: string; label: string }): React.JSX.Element {
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
