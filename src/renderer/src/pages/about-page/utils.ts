import type { UpdateCheckResult } from '@shared/types'

export function getDisplayErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': Error: /, '').trim()
}

export function getUpdateHint(
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

export function formatLastCheckedAt(date: Date | undefined): string {
  if (!date) return '尚未检查'
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}`
}

export function formatPercent(percent: number): string {
  return `${Math.round(percent)}%`
}

export function formatBytesPerSecond(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return ''
  if (bytesPerSecond >= 1024 * 1024) return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`
  return `${Math.max(1, Math.round(bytesPerSecond / 1024))} KB/s`
}
