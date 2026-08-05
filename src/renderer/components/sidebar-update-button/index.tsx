import { Download, Rocket } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/utils'
import { useAppUpdateStore } from '@/stores'

export function SidebarUpdateButton({ collapsed }: { collapsed: boolean }): React.JSX.Element | null {
  const result = useAppUpdateStore((state) => state.result)
  const isDownloading = useAppUpdateStore((state) => state.isDownloading)
  const isDownloaded = useAppUpdateStore((state) => state.isDownloaded)
  const downloadProgress = useAppUpdateStore((state) => state.downloadProgress)
  const download = useAppUpdateStore((state) => state.download)
  const install = useAppUpdateStore((state) => state.install)
  const openManualDownload = useAppUpdateStore((state) => state.openManualDownload)

  if (!result?.updateAvailable) return null

  const percent = Math.min(100, Math.max(0, downloadProgress?.percent ?? (isDownloaded ? 100 : 0)))
  const canAutoUpdate = result.canAutoUpdate
  const title = !canAutoUpdate
    ? `下载新版本 v${result.latestVersion}`
    : isDownloaded
      ? `安装并重启 v${result.latestVersion}`
      : isDownloading
        ? `正在下载 v${result.latestVersion}（${Math.round(percent)}%）`
        : `下载更新 v${result.latestVersion}`

  const handleClick = (): void => {
    if (!canAutoUpdate) {
      void openManualDownload()
      return
    }
    if (isDownloaded) {
      void install()
      return
    }
    if (isDownloading) {
      toast.message('正在下载更新…')
      return
    }
    void download()
  }

  return (
    <button
      aria-label={title}
      className={cn(
        'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-primary focus-visible:ring-ring absolute top-1/2 right-1 z-10 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg transition-colors outline-none focus-visible:ring-2 active:scale-95',
        collapsed && 'top-1 right-0.5 size-7 translate-y-0',
        isDownloaded && 'text-primary hover:text-primary',
        canAutoUpdate && isDownloading && 'cursor-not-allowed opacity-70',
      )}
      disabled={canAutoUpdate && isDownloading}
      title={title}
      type="button"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        handleClick()
      }}
    >
      {canAutoUpdate && (isDownloading || isDownloaded || percent > 0) ? (
        <ProgressRing percent={isDownloaded ? 100 : percent} />
      ) : null}
      {isDownloaded ? <Rocket size={collapsed ? 13 : 15} /> : <Download size={collapsed ? 13 : 15} />}
    </button>
  )
}

function ProgressRing({ percent }: { percent: number }): React.JSX.Element {
  const size = 28
  const stroke = 2
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - Math.min(100, Math.max(0, percent)) / 100)

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 m-auto -rotate-90"
      height={size}
      width={size}
    >
      <circle
        className="text-sidebar-border"
        cx={size / 2}
        cy={size / 2}
        fill="none"
        r={radius}
        stroke="currentColor"
        strokeWidth={stroke}
      />
      <circle
        className="text-primary transition-[stroke-dashoffset] duration-200"
        cx={size / 2}
        cy={size / 2}
        fill="none"
        r={radius}
        stroke="currentColor"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        strokeWidth={stroke}
      />
    </svg>
  )
}
