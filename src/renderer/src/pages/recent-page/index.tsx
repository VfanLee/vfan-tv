import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Clock3, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { RecentPlayItem } from '@shared/types'
import { ConfirmDialog, MediaPoster, PosterPlayOverlay } from '@renderer/components'
import { useRecentPlays } from '@renderer/hooks'
import { recentPlayToVodSearchResult } from '@renderer/services/playback'
import { useSearchContextStore } from '@/stores'

export function RecentPage(): React.JSX.Element {
  const navigate = useNavigate()
  const setContext = useSearchContextStore((state) => state.setContext)
  const { recentPlays, isLoading, deleteRecentPlay } = useRecentPlays()
  const [pendingDeleteItem, setPendingDeleteItem] = useState<RecentPlayItem>()

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
    <div className="bg-background text-foreground min-h-full px-10 py-9 pr-24">
      <div className="mx-auto max-w-[1500px]">
        <header className="mb-8">
          <div className="flex items-center gap-2">
            <Clock3 className="text-primary" size={22} />
            <h1 className="text-2xl font-semibold tracking-tight">最近播放</h1>
          </div>
        </header>

        {recentPlays.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,220px)] items-start gap-x-6 gap-y-9">
            {recentPlays.map((item) => (
              <RecentCard
                key={item.id}
                item={item}
                onClick={() => {
                  setContext(item.title, [recentPlayToVodSearchResult(item)])
                  navigate(`/vod/${item.sourceId}/${item.vodId}`, {
                    state: {
                      episodeUrl: item.episodeUrl,
                      initialTime: item.currentTime,
                    },
                  })
                }}
                onDelete={() => setPendingDeleteItem(item)}
              />
            ))}
          </div>
        ) : (
          <div className="border-input bg-card flex h-72 items-center justify-center rounded-xl">
            <div className="text-center">
              <Search className="text-muted-foreground mx-auto" size={28} />
              <div className="text-muted-foreground mt-3 text-sm font-semibold">
                {isLoading ? '正在加载最近播放' : '还没有播放记录'}
              </div>
            </div>
          </div>
        )}
      </div>
      {pendingDeleteItem ? (
        <ConfirmDialog
          confirmText="删除"
          description={`确定删除「${pendingDeleteItem.title}」的播放记录吗？`}
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

function RecentCard({
  item,
  onClick,
  onDelete,
}: {
  item: RecentPlayItem
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
        <MediaPoster className="aspect-[2/3]" poster={item.poster} title={item.title} overlay={<PosterPlayOverlay />} />
        <h2 className="text-foreground mt-3 truncate text-[15px] font-semibold">{item.title}</h2>
        <p className="text-muted-foreground mt-1 truncate text-sm">
          {item.sourceName} · {item.episodeName}
        </p>
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

function getProgress(item: RecentPlayItem): string {
  if (item.duration <= 0 || item.currentTime <= 0) {
    return '0%'
  }

  return `${Math.min(100, Math.round((item.currentTime / item.duration) * 100))}%`
}
