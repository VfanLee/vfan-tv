import { useEffect, useState } from 'react'
import { ArrowUpRight, CircleUserRound, Code2, Info, RefreshCw, Rocket } from 'lucide-react'
import { toast } from 'sonner'
import type { UpdateCheckResult } from '@shared/types'
import { Badge, Button, Card } from '@renderer/components'
import logoMarkUrl from '@renderer/assets/logo-mark.svg'
import { checkForUpdates, getCurrentVersion, isApiAvailable } from '@renderer/services/api'

const REPOSITORY_URL = 'https://github.com/vfanlee/VfanTV'
const AUTHOR_URL = 'https://github.com/vfanlee'

export function AboutPage(): React.JSX.Element {
  const [currentVersion, setCurrentVersion] = useState('')
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult>()
  const [isChecking, setIsChecking] = useState(false)
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
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="flex items-center gap-2">
          <Info className="text-primary" size={22} />
          <h1 className="text-2xl font-semibold tracking-tight">关于</h1>
        </header>

        <Card className="overflow-hidden">
          <div className="from-primary/10 via-card to-card flex items-center gap-6 bg-gradient-to-br p-8">
            <img alt="VfanTV" className="size-24 shrink-0" draggable={false} src={logoMarkUrl} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-3xl font-semibold tracking-tight">VfanTV</h2>
                <Badge>{currentVersion ? `v${currentVersion}` : '读取版本中'}</Badge>
              </div>
              <p className="text-muted-foreground mt-3 text-base">免费、源码公开的本地影视播放客户端</p>
              <a
                className="text-primary mt-4 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
                href={REPOSITORY_URL}
                rel="noreferrer"
                target="_blank"
              >
                GitHub 项目主页
                <ArrowUpRight size={15} />
              </a>
            </div>
          </div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="flex min-h-72 flex-col p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Rocket className="text-primary" size={19} />
                  <h2 className="text-lg font-semibold">版本更新</h2>
                </div>
                <p className="text-muted-foreground mt-2 text-sm">通过 GitHub Releases 获取最新版本。</p>
              </div>
              <UpdateStatus result={updateResult} />
            </div>

            <div className="border-border bg-muted/40 mt-5 rounded-lg border p-4">
              <div className="text-muted-foreground text-xs font-medium">当前版本</div>
              <div className="mt-1 text-lg font-semibold">{currentVersion ? `v${currentVersion}` : '—'}</div>
            </div>

            {updateResult?.updateAvailable ? (
              <div className="mt-4 min-w-0">
                <h3 className="text-sm font-semibold">{updateResult.releaseName}</h3>
                <p className="text-muted-foreground mt-2 max-h-24 overflow-y-auto text-sm leading-6 whitespace-pre-wrap">
                  {updateResult.releaseNotes}
                </p>
              </div>
            ) : null}

            <div className="mt-auto flex flex-wrap gap-3 pt-5">
              <Button disabled={!apiAvailable || isChecking} onClick={() => void handleCheckUpdates()}>
                <RefreshCw className={isChecking ? 'animate-spin' : undefined} data-icon="inline-start" />
                {isChecking ? '正在检查' : '检查更新'}
              </Button>
              {updateResult?.updateAvailable ? (
                <Button
                  variant="primary"
                  onClick={() => window.open(updateResult.releaseUrl, '_blank', 'noopener,noreferrer')}
                >
                  前往下载
                  <ArrowUpRight data-icon="inline-end" />
                </Button>
              ) : null}
            </div>
          </Card>

          <Card className="flex min-h-72 flex-col p-6">
            <div className="flex items-center gap-2">
              <CircleUserRound className="text-primary" size={19} />
              <h2 className="text-lg font-semibold">关于作者</h2>
            </div>
            <div className="mt-7 flex items-center gap-4">
              <div className="bg-primary/10 text-primary flex size-14 shrink-0 items-center justify-center rounded-full">
                <Code2 size={26} />
              </div>
              <div>
                <div className="text-lg font-semibold">VfanLee</div>
                <div className="text-muted-foreground mt-1 text-sm">VfanTV 作者与维护者</div>
              </div>
            </div>
            <p className="text-muted-foreground mt-6 text-sm leading-6">
              感谢使用 VfanTV。欢迎通过 GitHub 关注项目进展、反馈问题或参与贡献。
            </p>
            <a
              className="border-border hover:bg-accent hover:text-accent-foreground mt-auto inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 pt-0 text-sm font-medium transition-colors"
              href={AUTHOR_URL}
              rel="noreferrer"
              target="_blank"
            >
              <Code2 size={16} />
              访问作者 GitHub
            </a>
          </Card>
        </div>

        <p className="text-muted-foreground text-center text-xs">Copyright © 2026 VfanLee</p>
      </div>
    </div>
  )
}

function UpdateStatus({ result }: { result?: UpdateCheckResult }): React.JSX.Element {
  if (!result) return <Badge>尚未检查</Badge>
  if (result.updateAvailable) return <Badge>发现 v{result.latestVersion}</Badge>
  return <Badge>已是最新</Badge>
}
