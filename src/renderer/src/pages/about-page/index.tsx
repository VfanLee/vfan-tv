import { useCallback, useEffect, useState } from 'react'
import { CircleUserRound, Lightbulb, MessageCircle, SquareArrowOutUpRight } from 'lucide-react'
import { toast } from 'sonner'
import type { UpdateCheckResult, UpdateDownloadProgress } from '@shared/types'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Card } from '@/ui/card'
import logoMarkUrl from '@renderer/assets/logo-mark.svg'
import {
  checkForUpdates,
  downloadUpdate,
  getCurrentVersion,
  installUpdate,
  isApiAvailable,
  onUpdateEvent,
} from '@renderer/services/api'
import { openExternalUrl } from '@/utils'
import { ExternalLink, LinkCard, UpdateOptions, VersionItem } from './components/about-content'
import { formatLastCheckedAt, getDisplayErrorMessage, getUpdateHint } from './utils'

const REPOSITORY_URL = 'https://github.com/vfanlee/vfan-tv'
const AUTHOR_URL = 'https://github.com/vfanlee'
const FEEDBACK_URL = `${REPOSITORY_URL}/issues/new`

interface CheckUpdateOptions {
  force?: boolean
  showToast?: boolean
  shouldApplyResult?: () => boolean
}

interface ReleaseNoteSection {
  title: string
  items: string[]
}

function getReleaseNoteSections(notes: string): ReleaseNoteSection[] {
  const sections: ReleaseNoteSection[] = []
  let currentSection: ReleaseNoteSection | undefined

  for (const line of notes.split('\n')) {
    const value = line.trim()
    const heading = value.match(/^#{1,6}\s+(.+)$/)
    if (heading) {
      const title = heading[1].trim()
      if (title === '下载与安装') break
      if (title === '更新内容' || /^Vfan TV\s+v/i.test(title)) continue

      currentSection = { title, items: [] }
      sections.push(currentSection)
      continue
    }

    const item = value.match(/^[-*]\s+(.+)$/)
    if (item && currentSection) {
      currentSection.items.push(item[1].replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1'))
    }
  }

  return sections.filter((section) => section.items.length > 0)
}

function ReleaseNotes({ notes }: { notes: string }): React.JSX.Element | null {
  const sections = getReleaseNoteSections(notes)
  if (sections.length === 0) return null

  return (
    <div className="border-border mt-5 border-t pt-5">
      <h4 className="text-sm font-semibold">更新内容</h4>
      <div className="mt-3 space-y-4">
        {sections.map((section) => (
          <section key={section.title}>
            <h5 className="text-muted-foreground text-sm font-medium">{section.title}</h5>
            <ul className="text-muted-foreground mt-1.5 space-y-1 text-sm leading-6">
              {section.items.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden="true">·</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
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
            description: getDisplayErrorMessage(error),
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
        description: getDisplayErrorMessage(error),
      })
    }
  }, [])

  const handleInstallUpdate = useCallback(async (): Promise<void> => {
    try {
      await installUpdate()
    } catch (error) {
      toast.error('安装更新失败', {
        description: getDisplayErrorMessage(error),
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
              <ReleaseNotes notes={updateResult.releaseNotes} />
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
