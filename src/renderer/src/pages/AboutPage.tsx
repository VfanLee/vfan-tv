import { useEffect, useState } from 'react'
import { CircleUserRound, Download, Lightbulb, MessageCircle, SquareArrowOutUpRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { FaGithub } from 'react-icons/fa'
import { toast } from 'sonner'
import type { UpdateCheckResult } from '@shared/types'
import { Badge, Button, Card } from '@renderer/components'
import logoMarkUrl from '@renderer/assets/logo-mark.svg'
import { checkForUpdates, getCurrentVersion, isApiAvailable } from '@renderer/services/api'

const REPOSITORY_URL = 'https://github.com/vfanlee/VfanTV'
const AUTHOR_URL = 'https://github.com/vfanlee'
const FEEDBACK_URL = `${REPOSITORY_URL}/issues/new`

export function AboutPage(): React.JSX.Element {
  const [currentVersion, setCurrentVersion] = useState('')
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult>()
  const [isChecking, setIsChecking] = useState(false)
  const [showDownloadOptions, setShowDownloadOptions] = useState(false)
  const apiAvailable = isApiAvailable()

  useEffect(() => {
    if (!apiAvailable) return

    let active = true
    void getCurrentVersion().then((version) => {
      if (active) setCurrentVersion(version)
    })

    return () => {
      active = false
    }
  }, [apiAvailable])

  const handleCheckUpdates = async (): Promise<void> => {
    setIsChecking(true)
    try {
      const result = await checkForUpdates()
      setUpdateResult(result)
      setShowDownloadOptions(false)
      if (result.updateAvailable) {
        toast.success(`发现新版本 v${result.latestVersion}`)
      } else {
        toast.success('当前已是最新版本')
      }
    } catch (error) {
      toast.error('检查更新失败', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsChecking(false)
    }
  }

  return (
    <div className="bg-background text-foreground min-h-full px-10 py-9 pr-24">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <header>
          <div className="flex items-center gap-2">
            <h1 className="text-foreground text-3xl font-semibold tracking-tight">关于</h1>
          </div>
        </header>

        <Card className="overflow-hidden">
          <div className="flex flex-col gap-6 p-7 sm:flex-row sm:items-center">
            <img alt="VfanTV" className="size-20 shrink-0" draggable={false} src={logoMarkUrl} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-2xl font-semibold tracking-tight">VfanTV</h2>
                <Badge>GPL-3.0</Badge>
              </div>
              <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
                免费开源、开箱即用、跨平台的桌面端影视聚合播放器。
              </p>
              <p className="border-primary/30 bg-primary/5 text-muted-foreground mt-4 border-l-2 px-3 py-2 text-xs leading-5">
                本应用为空壳播放器，不内置播放源或直播源，请自行收集并配置。
              </p>
            </div>
            <ExternalLink href={REPOSITORY_URL} label="GitHub 仓库" />
          </div>
        </Card>

        <div className="grid items-stretch gap-5 lg:grid-cols-[1.35fr_0.65fr]">
          <Card className="flex h-full w-full flex-col p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <h2 className="text-lg font-semibold">版本与更新</h2>
              <UpdateStatus isChecking={isChecking} result={updateResult} />
            </div>

            <div className="border-border mt-5 overflow-hidden rounded-xl border">
              <div className="grid gap-5 p-5 sm:grid-cols-[1fr_1fr_minmax(8.75rem,auto)] sm:items-end">
                <VersionItem emphasis label="当前版本" value={currentVersion ? `v${currentVersion}` : '读取中'} />
                <VersionItem label="最新版本" value={updateResult ? `v${updateResult.latestVersion}` : '尚未检查'} />
                <div className="flex flex-col gap-1.5 sm:items-end">
                  <div className="text-muted-foreground text-xs font-medium">更新操作</div>
                  <Button
                    className="w-full sm:w-auto"
                    disabled={!apiAvailable || isChecking}
                    onClick={() => void handleCheckUpdates()}
                  >
                    {isChecking ? '正在检查' : '检查更新'}
                  </Button>
                  {updateResult?.updateAvailable ? (
                    <Button
                      className="h-8 w-full rounded-lg px-3 sm:w-auto"
                      onClick={() => {
                        if (updateResult.downloadUrl) {
                          setShowDownloadOptions((visible) => !visible)
                        } else {
                          openExternal(updateResult.releaseUrl)
                        }
                      }}
                    >
                      <Download data-icon="inline-start" />
                      {updateResult.downloadUrl ? '下载线路' : '前往 Release'}
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="border-border bg-primary/5 text-muted-foreground flex items-center gap-2 border-t px-5 py-3 text-xs">
                <Lightbulb className="text-primary shrink-0" size={16} />
                <span>{getUpdateHint(updateResult, isChecking)}</span>
              </div>
            </div>

            {updateResult?.updateAvailable ? (
              <div className="border-border mt-5 min-w-0 border-t pt-5">
                <h3 className="text-sm font-semibold">{updateResult.releaseName}</h3>
                <p className="text-muted-foreground mt-1.5 max-h-24 overflow-y-auto text-sm leading-6 whitespace-pre-wrap">
                  {updateResult.releaseNotes}
                </p>
                {showDownloadOptions && updateResult.downloadUrl ? (
                  <DownloadOptions fileName={updateResult.downloadName} url={updateResult.downloadUrl} />
                ) : null}
              </div>
            ) : null}
          </Card>

          <div className="grid h-full gap-5 lg:grid-rows-2">
            <InfoCard actionLabel="作者主页" href={AUTHOR_URL} icon={CircleUserRound} title="VfanLee" />
            <InfoCard actionLabel="提交 Issue" href={FEEDBACK_URL} icon={MessageCircle} title="意见反馈" />
          </div>
        </div>

        <p className="text-muted-foreground text-center text-sm">Copyright © 2026 VfanLee</p>
      </div>
    </div>
  )
}

const downloadRoutePrefixes = [
  { label: '原始线路', prefix: '' },
  { label: 'gh-proxy', prefix: 'https://gh-proxy.org/' },
  { label: 'Cloudflare (v4)', prefix: 'https://v4.gh-proxy.org/' },
  { label: 'Cloudflare (v4/v6)', prefix: 'https://v6.gh-proxy.org/' },
  { label: 'Fastly (v4)', prefix: 'https://cdn.gh-proxy.org/' },
] as const

function DownloadOptions({ fileName, url }: { fileName?: string; url: string }): React.JSX.Element {
  return (
    <div className="bg-muted/40 mt-4 rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">选择下载线路</h4>
        {fileName ? <span className="text-muted-foreground max-w-full truncate text-xs">{fileName}</span> : null}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {downloadRoutePrefixes.map((route) => (
          <a
            key={route.label}
            className="border-border bg-background hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring inline-flex h-9 items-center justify-between gap-3 rounded-xl border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2"
            href={`${route.prefix}${url}`}
            rel="noreferrer"
            target="_blank"
          >
            {route.label}
            <SquareArrowOutUpRight className="shrink-0" size={14} />
          </a>
        ))}
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
  if (isChecking) return '正在从 GitHub Releases 获取最新版本信息…'
  if (!result) return '提示：点击「检查更新」获取最新版本信息'
  if (result.updateAvailable) return `发现新版本 v${result.latestVersion}，可查看更新说明并选择下载线路`
  return '当前已是最新版本'
}

function UpdateStatus({ isChecking, result }: { isChecking: boolean; result?: UpdateCheckResult }): React.JSX.Element {
  const label = isChecking ? '正在检查' : result?.updateAvailable ? '有可用更新' : result ? '已是最新' : '尚未检查'

  return (
    <Badge className="gap-2 px-3 py-1">
      <span className="size-2 rounded-full bg-emerald-500" />
      状态：{label}
    </Badge>
  )
}

function InfoCard({
  actionLabel,
  href,
  icon: Icon,
  title,
}: {
  actionLabel: string
  description?: string
  href: string
  icon: LucideIcon
  title: string
}): React.JSX.Element {
  return (
    <Card className="flex min-h-28 flex-col justify-center p-5">
      <div className="flex items-center gap-2">
        <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-full">
          <Icon size={19} />
        </div>
        <h2 className="font-semibold">{title}</h2>
      </div>
      <a
        className="text-primary focus-visible:ring-ring mt-4 inline-flex w-fit items-center gap-1.5 rounded-xl text-sm font-medium outline-none hover:underline focus-visible:ring-2"
        href={href}
        rel="noreferrer"
        target="_blank"
      >
        {actionLabel}
        <SquareArrowOutUpRight size={15} />
      </a>
    </Card>
  )
}

function ExternalLink({ href, label }: { href: string; label: string }): React.JSX.Element {
  return (
    <a
      className="border-border hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      <FaGithub aria-hidden size={18} />
      {label}
      <SquareArrowOutUpRight size={15} />
    </a>
  )
}

function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}
