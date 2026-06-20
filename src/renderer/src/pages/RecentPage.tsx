import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Clock3, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { HomeData, RecentPlayItem } from '@shared/types'
import { MediaPoster, PosterPlayOverlay } from '@renderer/components'
import { getHomeData, removeRecentPlay } from '@renderer/services/api'
import { recentPlayToVodSearchResult } from '@renderer/services/playback'
import { useSearchContextStore } from '@renderer/stores/search-context'

export function RecentPage(): React.JSX.Element {
  const navigate = useNavigate()
  const setContext = useSearchContextStore((state) => state.setContext)
  const [homeData, setHomeData] = useState<HomeData>({ recentPlays: [], recommendations: [] })
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true

    void getHomeData()
      .then((nextHomeData) => {
        if (active) {
          setHomeData(nextHomeData)
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [])

  const handleDelete = async (item: RecentPlayItem): Promise<void> => {
    if (!window.confirm(`确定删除「${item.title}」的播放记录吗？`)) {
      return
    }

    try {
      await removeRecentPlay(item.title)
      setHomeData((current) => ({
        ...current,
        recentPlays: current.recentPlays.filter((recentItem) => recentItem.title !== item.title),
      }))
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

        {homeData.recentPlays.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] items-start gap-x-6 gap-y-9">
            {homeData.recentPlays.map((item) => (
              <RecentCard
                key={item.id}
                item={item}
                onClick={() => {
                  setContext(item.title, [recentPlayToVodSearchResult(item)])
                  navigate(`/player/${item.sourceId}/${item.vodId}`, {
                    state: {
                      episodeUrl: item.episodeUrl,
                      initialTime: item.currentTime,
                    },
                  })
                }}
                onDelete={() => void handleDelete(item)}
              />
            ))}
          </div>
        ) : (
          <div className="border-input bg-card flex h-72 items-center justify-center rounded-xl border border-dashed">
            <div className="text-center">
              <Search className="text-muted-foreground mx-auto" size={28} />
              <div className="mt-3 text-sm font-semibold">{isLoading ? '正在加载最近播放' : '还没有播放记录'}</div>
            </div>
          </div>
        )}
      </div>
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
    <div className="group relative min-w-0">
      <button
        className="focus-visible:ring-ring focus-visible:ring-offset-background w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
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
        className="bg-background/85 text-muted-foreground hover:bg-destructive focus-visible:ring-ring absolute top-2 right-2 flex size-8 items-center justify-center rounded-full opacity-0 shadow-sm backdrop-blur transition group-hover:opacity-100 hover:text-white focus:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
        type="button"
        title="删除播放记录"
        onClick={onDelete}
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
