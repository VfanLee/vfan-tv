import { useState } from 'react'
import { useNavigate } from 'react-router'
import { History, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { RecentPlayItem } from '@/types'
import { ConfirmDialog, EmptyState, MediaPoster, PageHeader, PosterPlayOverlay } from '@/components'
import { getRecentUpdateKey, useRecentPlays, useRecentUpdates } from '@/hooks'
import { recentPlayToVodSearchResult } from '@/platform/playback'
import { useSearchContextStore } from '@/stores'

/** 渲染最近播放页面 */
export function RecentPage(): React.JSX.Element {
  const navigate = useNavigate()
  const setContext = useSearchContextStore((state) => state.setContext)
  const { recentPlays, isLoading, deleteRecentPlay } = useRecentPlays()
  const updates = useRecentUpdates()
  const [pendingDeleteItem, setPendingDeleteItem] = useState<RecentPlayItem>()

  /** 处理当前记录的删除操作 */
  const handleDelete = async (item: RecentPlayItem): Promise<void> => {
    try {
      await deleteRecentPlay(item)
      toast.success('已删除播放记录')
    } catch (error) {
      toast.error('删除失败', {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <div className="text-foreground min-h-full bg-transparent px-10 py-9">
      <div className="w-full">
        <PageHeader
          className="items-center justify-start gap-2"
          title="最近播放"
          actions={
            <button
              className="text-muted-foreground hover:bg-accent hover:text-primary focus-visible:ring-ring inline-flex size-8 shrink-0 items-center justify-center rounded-full transition-colors outline-none focus-visible:ring-2 disabled:cursor-wait disabled:opacity-60"
              aria-label={updates.isChecking ? '正在检查更新' : '检查更新'}
              aria-busy={updates.isChecking}
              title={updates.isChecking ? '正在检查更新' : '检查更新'}
              type="button"
              disabled={updates.isChecking}
              onClick={() => void updates.check(true)}
            >
              <RefreshCw
                className={updates.isChecking ? 'animate-spin motion-reduce:animate-none' : undefined}
                size={17}
              />
            </button>
          }
        />
        {updates.checkError ? (
          <p className="text-muted-foreground mb-4 text-sm">
            检查失败：{updates.checkError}，可点击标题旁的刷新图标重试。
          </p>
        ) : null}

        {recentPlays.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,220px)] items-start gap-x-6 gap-y-9">
            {recentPlays.map((item) => (
              <RecentCard
                key={JSON.stringify([item.sourceId, item.vodId])}
                item={item}
                checkError={updates.errors[getRecentUpdateKey(item.sourceId, item.vodId)]}
                isChecking={updates.isChecking}
                onClick={() => {
                  setContext(item.title, [recentPlayToVodSearchResult(item)])
                  navigate(`/vod/${item.sourceId}/${item.vodId}`, {
                    state: {
                      episodeUrl: item.episodeUrl,
                      episodeName: item.episodeName,
                      lineName: item.lineName,
                      initialTime: item.positionSeconds,
                    },
                  })
                }}
                onDelete={() => setPendingDeleteItem(item)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            description={isLoading ? '正在加载播放记录…' : '播放过的视频会出现在这里。'}
            icon={isLoading ? Loader2 : History}
            iconClassName={isLoading ? 'animate-spin' : undefined}
            title={isLoading ? '正在加载最近播放' : '还没有播放记录'}
          />
        )}
      </div>
      {pendingDeleteItem ? (
        <ConfirmDialog
          description={`确定删除该播放记录吗？`}
          title="删除播放记录"
          onCancel={() => setPendingDeleteItem(undefined)}
          onConfirm={async () => {
            await handleDelete(pendingDeleteItem)
            setPendingDeleteItem(undefined)
          }}
        />
      ) : null}
    </div>
  )
}

/** 渲染最近播放卡片 */
function RecentCard({
  item,
  checkError,
  isChecking,
  onClick,
  onDelete,
}: {
  item: RecentPlayItem
  checkError?: string
  isChecking: boolean
  onClick: () => void
  onDelete: () => void
}): React.JSX.Element {
  const progress = getProgress(item)

  return (
    <div className="group relative w-[220px] min-w-0 self-start rounded-xl">
      <button
        className="focus-visible:ring-ring focus-visible:ring-offset-background w-full rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        type="button"
        onClick={onClick}
      >
        <MediaPoster
          className="aspect-[2/3]"
          poster={item.poster}
          sourceId={item.sourceId}
          title={item.title}
          overlay={
            <>
              <PosterPlayOverlay />
              <span
                className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-3 py-2 text-center text-xs font-bold text-white [text-shadow:0_1px_3px_rgb(0_0_0/80%)]"
                title={item.sourceName}
              >
                {item.sourceName}
              </span>
              {item.updateInfo?.pendingEpisodeCount ? (
                <span className="bg-primary text-primary-foreground absolute top-2 left-2 rounded-lg px-2 py-1 text-xs font-semibold">
                  有更新
                </span>
              ) : null}
            </>
          }
        />
        <h2 className="text-foreground mt-3 truncate text-[15px] font-semibold">{item.title}</h2>
        <p className="text-muted-foreground mt-1 truncate text-sm">上次看到 {item.episodeName}</p>
        {checkError ? (
          <p className="mt-1 truncate text-xs text-amber-600" title={checkError}>
            检查失败，可点击刷新图标重试
          </p>
        ) : isChecking ? (
          <p className="text-muted-foreground mt-1 text-xs">正在检查更新…</p>
        ) : null}
        <div className="mt-2 flex items-center gap-2">
          <div className="bg-muted h-1 min-w-0 flex-1 overflow-hidden rounded-full">
            <div className="bg-primary h-full rounded-full" style={{ width: progress }} />
          </div>
          <span className="text-muted-foreground shrink-0 text-xs font-medium">已看 {progress}</span>
        </div>
      </button>
      <button
        className="bg-destructive hover:bg-destructive/90 focus-visible:ring-ring absolute top-2 right-2 z-20 flex size-8 items-center justify-center rounded-full text-white opacity-0 shadow-sm transition group-hover:opacity-100 focus:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
        type="button"
        title="删除播放记录"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onDelete()
        }}
      >
        <Trash2 size={15} />
      </button>
    </div>
  )
}

/** 计算最近播放记录的观看进度百分比 */
function getProgress(item: RecentPlayItem): string {
  if (item.duration <= 0 || item.positionSeconds <= 0) {
    return '0%'
  }

  return `${Math.min(100, Math.round((item.positionSeconds / item.duration) * 100))}%`
}
