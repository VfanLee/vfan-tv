import { useCallback, useEffect, useState } from 'react'
import { CircleUserRound, Lightbulb, MessageCircle, SquareArrowOutUpRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { FaGithub } from 'react-icons/fa'
import { toast } from 'sonner'
import { RELEASE_ROUTE_PREFIXES, UPDATE_CHECK_CACHE_KEY, applyReleaseRoutePrefix } from '@shared/constants'
import type { UpdateCheckResult } from '@shared/types'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Card } from '@renderer/components/ui/card'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select'
import logoMarkUrl from '@renderer/assets/logo-mark.svg'
import { checkForUpdates, getCurrentVersion, isApiAvailable } from '@renderer/services/api'
import { openExternalUrl } from '@renderer/lib/open-external'
import { cn } from '@renderer/lib/utils'

const REPOSITORY_URL = 'https://github.com/vfanlee/vfan-tv'
const AUTHOR_URL = 'https://github.com/vfanlee'
const FEEDBACK_URL = `${REPOSITORY_URL}/issues/new`
const DOWNLOAD_SPEED_TEST_TIMEOUT_MS = 6000
const UPDATE_CHECK_CACHE_TTL_MS = 30 * 60 * 1000

interface DownloadRouteSpeed {
  elapsedMs?: number
  errorMessage?: string
  status: 'idle' | 'testing' | 'success' | 'error'
}

interface UpdateCheckCache {
  checkedAt: string
  result: UpdateCheckResult
}

interface CheckUpdateOptions {
  cacheVersion?: string
  force?: boolean
  showToast?: boolean
  shouldApplyResult?: () => boolean
}

export function AboutPage(): React.JSX.Element {
  const [currentVersion, setCurrentVersion] = useState('')
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult>()
  const [isChecking, setIsChecking] = useState(false)
  const [lastCheckedAt, setLastCheckedAt] = useState<Date>()
  const apiAvailable = isApiAvailable()

  const handleCheckUpdates = useCallback(
    async ({
      cacheVersion,
      force = false,
      showToast = true,
      shouldApplyResult = () => true,
    }: CheckUpdateOptions = {}): Promise<void> => {
      if (!force && cacheVersion) {
        const cached = readUpdateCheckCache(cacheVersion)
        if (cached) {
          setUpdateResult(cached.result)
          setLastCheckedAt(new Date(cached.checkedAt))
          return
        }
      }

      setIsChecking(true)
      try {
        const result = await checkForUpdates()
        if (!shouldApplyResult()) return

        const checkedAt = new Date()
        setUpdateResult(result)
        setLastCheckedAt(checkedAt)
        writeUpdateCheckCache({ checkedAt: checkedAt.toISOString(), result })
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

  useEffect(() => {
    if (!apiAvailable) return

    let active = true
    void getCurrentVersion().then((version) => {
      if (!active) return

      setCurrentVersion(version)
      const cached = readUpdateCheckCache(version)
      if (cached) {
        setUpdateResult(cached.result)
        setLastCheckedAt(new Date(cached.checkedAt))
        return
      }

      void handleCheckUpdates({ cacheVersion: version, showToast: false, shouldApplyResult: () => active })
    })

    return () => {
      active = false
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
            <span>{getUpdateHint(updateResult, isChecking)}</span>
          </div>

          <div className="grid gap-5 p-6 sm:grid-cols-2">
            <VersionItem emphasis label="当前版本" value={currentVersion ? `v${currentVersion}` : '读取中'} />
            <VersionItem label="最新版本" value={updateResult ? `v${updateResult.latestVersion}` : '尚未检查'} />
          </div>

          {updateResult?.updateAvailable ? (
            <div className="border-border border-t px-6 py-5">
              <h3 className="text-sm font-semibold">{updateResult.releaseName}</h3>
              {updateResult.downloadUrl ? (
                <DownloadOptions fileName={updateResult.downloadName} url={updateResult.downloadUrl} />
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

const downloadRoutePrefixes = RELEASE_ROUTE_PREFIXES

function DownloadOptions({ fileName, url }: { fileName?: string; url: string }): React.JSX.Element {
  const [selectedRouteLabel, setSelectedRouteLabel] = useState(downloadRoutePrefixes[0]?.label ?? '')
  const [speedResults, setSpeedResults] = useState<Record<string, DownloadRouteSpeed>>(() =>
    Object.fromEntries(downloadRoutePrefixes.map((route) => [route.label, { status: 'idle' }])),
  )
  const [isTestingSpeed, setIsTestingSpeed] = useState(false)
  const selectedRoute =
    downloadRoutePrefixes.find((route) => route.label === selectedRouteLabel) ?? downloadRoutePrefixes[0]
  const hasSpeedResult = Object.values(speedResults).some(
    (result) => result.status === 'success' || result.status === 'error',
  )

  const testDownloadSpeed = useCallback(async (): Promise<void> => {
    setIsTestingSpeed(true)
    setSpeedResults(Object.fromEntries(downloadRoutePrefixes.map((route) => [route.label, { status: 'testing' }])))

    const results = await Promise.all(
      downloadRoutePrefixes.map(async (route) => {
        const result = await testDownloadRoute(applyReleaseRoutePrefix(url, route.prefix))
        return [route.label, result] as const
      }),
    )
    const nextResults = Object.fromEntries(results)
    const fastest = getFastestRoute(nextResults)

    setSpeedResults(nextResults)
    if (fastest) {
      setSelectedRouteLabel(fastest.label)
    }
    setIsTestingSpeed(false)
  }, [url])

  useEffect(() => {
    let active = true

    queueMicrotask(() => {
      if (!active) return

      setIsTestingSpeed(true)
      setSpeedResults(Object.fromEntries(downloadRoutePrefixes.map((route) => [route.label, { status: 'testing' }])))
      void Promise.all(
        downloadRoutePrefixes.map(async (route) => {
          const result = await testDownloadRoute(applyReleaseRoutePrefix(url, route.prefix))
          return [route.label, result] as const
        }),
      ).then((results) => {
        if (!active) return

        const nextResults = Object.fromEntries(results)
        const fastest = getFastestRoute(nextResults)
        setSpeedResults(nextResults)
        if (fastest) {
          setSelectedRouteLabel(fastest.label)
        }
        setIsTestingSpeed(false)
      })
    })

    return () => {
      active = false
    }
  }, [url])

  return (
    <div className="bg-muted/40 mt-4 rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">更新下载</h4>
        {fileName ? <span className="text-muted-foreground max-w-full truncate text-xs">{fileName}</span> : null}
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Select value={selectedRouteLabel} onValueChange={setSelectedRouteLabel}>
          <SelectTrigger className="w-full flex-1">
            <SelectValue placeholder="选择下载线路" />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            <SelectGroup>
              {downloadRoutePrefixes.map((route) => (
                <SelectItem key={route.label} value={route.label}>
                  <span className="min-w-0 flex-1 truncate">{route.label}</span>
                  <SpeedResultTag result={speedResults[route.label]} />
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <div className="flex shrink-0 gap-2">
          <Button
            disabled={!selectedRoute}
            size="lg"
            onClick={() => {
              if (selectedRoute) void openExternalUrl(applyReleaseRoutePrefix(url, selectedRoute.prefix))
            }}
          >
            手动下载
          </Button>
          <Button disabled={isTestingSpeed} size="lg" variant="outline" onClick={() => void testDownloadSpeed()}>
            {isTestingSpeed ? '测速中' : hasSpeedResult ? '重新测速' : '测速'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function VersionItem({
  emphasis = false,
  label,
  value,
}: {
  emphasis?: boolean
  label: string
  value: string
}): React.JSX.Element {
  return (
    <div>
      <div className="text-muted-foreground text-xs font-medium">{label}</div>
      <div className={emphasis ? 'text-primary mt-1 text-xl font-semibold' : 'mt-1 text-base font-semibold'}>
        {value}
      </div>
    </div>
  )
}

function getUpdateHint(result: UpdateCheckResult | undefined, isChecking: boolean): string {
  if (isChecking) return '正在获取最新版本信息…'
  if (!result) return '提示：点击「检查更新」获取最新版本'
  if (result.updateAvailable) return `发现新版本 v${result.latestVersion}，可查看更新说明并选择下载线路`
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

function readUpdateCheckCache(currentVersion: string): UpdateCheckCache | undefined {
  try {
    const raw = window.localStorage.getItem(UPDATE_CHECK_CACHE_KEY)
    if (!raw) return undefined

    const parsed = JSON.parse(raw) as Partial<UpdateCheckCache>
    const checkedAt = parsed.checkedAt ? new Date(parsed.checkedAt) : undefined
    const result = parsed.result

    if (!checkedAt || Number.isNaN(checkedAt.getTime()) || !result) {
      clearUpdateCheckCache()
      return undefined
    }

    if (Date.now() - checkedAt.getTime() > UPDATE_CHECK_CACHE_TTL_MS || result.currentVersion !== currentVersion) {
      clearUpdateCheckCache()
      return undefined
    }

    return { checkedAt: checkedAt.toISOString(), result }
  } catch {
    clearUpdateCheckCache()
    return undefined
  }
}

function writeUpdateCheckCache(cache: UpdateCheckCache): void {
  try {
    window.localStorage.setItem(UPDATE_CHECK_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Cache is best-effort; update checks should still work if storage is unavailable.
  }
}

function clearUpdateCheckCache(): void {
  try {
    window.localStorage.removeItem(UPDATE_CHECK_CACHE_KEY)
  } catch {
    // Ignore storage cleanup failures.
  }
}

async function testDownloadRoute(url: string): Promise<DownloadRouteSpeed> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), DOWNLOAD_SPEED_TEST_TIMEOUT_MS)
  const startedAt = performance.now()

  try {
    await fetch(url, {
      cache: 'no-store',
      method: 'HEAD',
      mode: 'no-cors',
      signal: controller.signal,
    })

    return {
      elapsedMs: Math.round(performance.now() - startedAt),
      status: 'success',
    }
  } catch (error) {
    return {
      errorMessage: error instanceof DOMException && error.name === 'AbortError' ? '超时' : '不可用',
      status: 'error',
    }
  } finally {
    window.clearTimeout(timeoutId)
  }
}

function getFastestRoute(
  results: Record<string, DownloadRouteSpeed>,
): { elapsedMs: number; label: string } | undefined {
  return Object.entries(results).reduce<{ elapsedMs: number; label: string } | undefined>(
    (fastest, [label, result]) => {
      if (result.status !== 'success' || typeof result.elapsedMs !== 'number') return fastest
      if (!fastest || result.elapsedMs < fastest.elapsedMs) return { elapsedMs: result.elapsedMs, label }
      return fastest
    },
    undefined,
  )
}

function formatSpeedResult(result: DownloadRouteSpeed | undefined): string {
  if (!result || result.status === 'idle') return '待测速'
  if (result.status === 'testing') return '测速中'
  if (result.status === 'error') return result.errorMessage ?? '不可用'
  return formatElapsedMs(result.elapsedMs)
}

function formatElapsedMs(elapsedMs: number | undefined): string {
  return typeof elapsedMs === 'number' ? `${elapsedMs} ms` : '未知'
}

function SpeedResultTag({ result }: { result: DownloadRouteSpeed | undefined }): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[11px] font-semibold',
        getSpeedResultTagClassName(result),
      )}
    >
      {formatSpeedResult(result)}
    </span>
  )
}

function getSpeedResultTagClassName(result: DownloadRouteSpeed | undefined): string {
  if (!result || result.status === 'idle') {
    return 'bg-muted text-muted-foreground'
  }

  if (result.status === 'testing') {
    return 'bg-primary/10 text-primary'
  }

  if (result.status === 'error') {
    return 'bg-destructive/10 text-destructive'
  }

  if (typeof result.elapsedMs !== 'number') {
    return 'bg-muted text-muted-foreground'
  }

  if (result.elapsedMs <= 800) {
    return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
  }

  if (result.elapsedMs <= 2000) {
    return 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400'
  }

  return 'bg-orange-500/15 text-orange-700 dark:text-orange-400'
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
