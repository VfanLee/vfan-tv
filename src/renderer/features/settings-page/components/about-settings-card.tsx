import { useEffect, useState } from 'react'
import { CircleUserRound, Download, MessageCircle, Rocket, SquareArrowOutUpRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { FaGithub } from 'react-icons/fa'
import { SettingsCard } from '@renderer/components'
import logoMarkUrl from '@renderer/assets/logo-mark.svg'
import { getCurrentVersion, isApiAvailable } from '@renderer/platform/api'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { cn, openExternalUrl } from '@/utils'
import { useAppUpdateStore } from '@/stores'

const REPOSITORY_URL = 'https://github.com/vfanlee/vfan-tv'
const AUTHOR_URL = 'https://github.com/vfanlee'
const FEEDBACK_URL = `${REPOSITORY_URL}/issues/new`

export function AboutSettingsCard(): React.JSX.Element {
  const apiAvailable = isApiAvailable()
  const [currentVersion, setCurrentVersion] = useState('')
  const updateResult = useAppUpdateStore((state) => state.result)
  const latestVersion = updateResult?.latestVersion
  const updateAvailable = updateResult?.updateAvailable === true
  const isDownloading = useAppUpdateStore((state) => state.isDownloading)
  const isDownloaded = useAppUpdateStore((state) => state.isDownloaded)
  const downloadProgress = useAppUpdateStore((state) => state.downloadProgress)
  const download = useAppUpdateStore((state) => state.download)
  const install = useAppUpdateStore((state) => state.install)
  const openManualDownload = useAppUpdateStore((state) => state.openManualDownload)

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

  return (
    <SettingsCard description="应用信息与版本。" title="关于">
      <div className="flex flex-col gap-5 p-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <img alt="Vfan TV" className="size-14 shrink-0" draggable={false} src={logoMarkUrl} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h3 className="text-xl font-semibold tracking-tight">Vfan TV</h3>
                <Badge>GPL-3.0</Badge>
              </div>
              <p className="text-muted-foreground mt-1.5 text-sm leading-6">
                免费开源、跨平台的桌面端影视聚合客户端（空壳）。
              </p>
            </div>
          </div>
          <ExternalLinkButton href={REPOSITORY_URL} label="GitHub" />
        </div>

        <p className="border-primary/30 bg-primary/5 text-muted-foreground border-l-2 px-3 py-2 text-xs leading-5">
          本应用为影视聚合客户端（空壳），不提供内容源。仅供个人学习与研究；请遵守当地法律，勿用于商业或公开服务。
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <VersionItem label="当前版本" value={currentVersion ? `v${currentVersion}` : '读取中'} />
          <VersionItem
            label="最新版本"
            value={latestVersion ? (updateAvailable ? `v${latestVersion}（有更新）` : `v${latestVersion}`) : '检查中'}
          />
        </div>

        {updateAvailable && updateResult ? (
          <div className="border-primary/20 bg-primary/5 flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4">
            <div>
              <p className="font-semibold">新版本 v{updateResult.latestVersion} 可用</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {isDownloading
                  ? `正在下载 ${Math.round(downloadProgress?.percent ?? 0)}%`
                  : isDownloaded
                    ? '更新已下载，重启应用即可完成安装。'
                    : '可在这里下载并安装最新版本。'}
              </p>
            </div>
            <Button
              disabled={isDownloading}
              onClick={() => {
                if (isDownloaded) void install()
                else if (updateResult.canAutoUpdate) void download()
                else void openManualDownload('direct')
              }}
            >
              {isDownloaded ? <Rocket /> : <Download />}
              {isDownloaded ? '安装并重启' : updateResult.canAutoUpdate ? '下载更新' : '手动下载'}
            </Button>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <LinkCard href={AUTHOR_URL} icon={CircleUserRound} title="关于作者" />
          <LinkCard href={FEEDBACK_URL} icon={MessageCircle} title="意见反馈" />
        </div>

        <p className="text-muted-foreground text-center text-sm">Copyright © 2026 VfanLee</p>
      </div>
    </SettingsCard>
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

function LinkCard({ href, icon: Icon, title }: { href: string; icon: LucideIcon; title: string }): React.JSX.Element {
  return (
    <button
      className={cn(
        'border-border bg-card text-card-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring',
        'flex min-h-16 w-full items-center gap-3 rounded-xl border px-4 text-left shadow-sm transition-colors outline-none focus-visible:ring-2',
      )}
      type="button"
      onClick={() => void openExternalUrl(href)}
    >
      <div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-full">
        <Icon size={17} />
      </div>
      <span className="text-sm font-semibold">{title}</span>
      <SquareArrowOutUpRight className="text-muted-foreground ml-auto shrink-0" size={15} />
    </button>
  )
}

function ExternalLinkButton({ href, label }: { href: string; label: string }): React.JSX.Element {
  return (
    <button
      className="border-border hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2"
      type="button"
      onClick={() => void openExternalUrl(href)}
    >
      <FaGithub aria-hidden size={18} />
      {label}
      <SquareArrowOutUpRight size={15} />
    </button>
  )
}
