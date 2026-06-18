import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router'
import { ChevronRight, Clapperboard, Mic2, Play, Star, Trash2, Tv } from 'lucide-react'
import { toast } from 'sonner'
import type { RecentPlayItem, RecommendationItem } from '@shared/types'
import { MediaPoster, PosterCardSkeleton } from '@renderer/components'
import { categorySections, removeRecentPlay } from '@renderer/services/api'
import { recentPlayToVodSearchResult } from '@renderer/services/playback'
import { useAppDataStore } from '@renderer/stores/app-data'
import { useSearchContextStore } from '@renderer/stores/search-context'

const categoryIcons: Record<RecommendationItem['category'], typeof Clapperboard> = {
  movie: Clapperboard,
  tv: Tv,
  show: Mic2,
}

export function HomePage(): React.JSX.Element {
  const navigate = useNavigate()
  const setContext = useSearchContextStore((state) => state.setContext)
  const homeData = useAppDataStore((state) => state.homeData)
  const isLoading = useAppDataStore((state) => !state.homeInitialized && !state.homeErrorMessage)
  const loadHome = useAppDataStore((state) => state.loadHome)
  const removeRecentPlayFromCache = useAppDataStore((state) => state.removeRecentPlayFromCache)

  useEffect(() => {
    void loadHome()
  }, [loadHome])

  const recommendationsByCategory = useMemo(() => {
    return categorySections.reduce(
      (groupedRecommendations, section) => {
        groupedRecommendations[section.key] = homeData.recommendations.filter((item) => item.category === section.key)
        return groupedRecommendations
      },
      {} as Record<RecommendationItem['category'], RecommendationItem[]>,
    )
  }, [homeData.recommendations])

  const handleDeleteRecent = async (item: RecentPlayItem): Promise<void> => {
    if (!window.confirm(`确定删除「${item.title}」的播放记录吗？`)) {
      return
    }

    try {
      await removeRecentPlay(item.title)
      removeRecentPlayFromCache(item.title)
      toast.success('已删除播放记录')
    } catch (error) {
      toast.error('删除失败', {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <div className="bg-background text-foreground min-h-full px-10 py-7">
      <div className="mx-auto max-w-[1500px]">
        <section className="mb-11">
          <SectionHeader title="最近播放" onMore={() => navigate('/recent')} />
          {isLoading ? (
            <HomeShelfSkeleton />
          ) : homeData.recentPlays.length > 0 ? (
            <div className="no-scrollbar grid auto-cols-[minmax(180px,194px)] grid-flow-col items-start gap-6 overflow-x-auto pb-4">
              {homeData.recentPlays.map((item) => (
                <RecentPlayCard
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
                  onDelete={() => void handleDeleteRecent(item)}
                />
              ))}
            </div>
          ) : (
            <EmptyShelf
              description={isLoading ? '正在加载最近播放' : '播放过的视频会出现在这里'}
              title="还没有播放记录"
            />
          )}
        </section>

        <div className="space-y-11">
          {categorySections.map((section) => {
            const items = recommendationsByCategory[section.key]
            const Icon = categoryIcons[section.key]

            return (
              <section key={section.key}>
                <SectionHeader
                  icon={Icon}
                  title={section.title}
                  onMore={() => navigate(`/hot?category=${section.key}`)}
                />
                {isLoading ? (
                  <HomeShelfSkeleton />
                ) : items.length > 0 ? (
                  <div className="no-scrollbar grid auto-cols-[minmax(180px,194px)] grid-flow-col items-start gap-6 overflow-x-auto pb-4">
                    {items.map((item) => (
                      <RecommendationCard
                        key={`${item.category}-${item.id}`}
                        item={item}
                        onClick={() => navigate(`/search?keyword=${encodeURIComponent(item.title)}`)}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyShelf
                    description={isLoading ? '正在加载热门推荐' : `暂时没有拿到热门${section.title}`}
                    title={`${section.title}推荐`}
                  />
                )}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function HomeShelfSkeleton(): React.JSX.Element {
  return (
    <div className="grid grid-cols-[repeat(6,minmax(0,194px))] gap-6 overflow-hidden pb-4">
      {Array.from({ length: 6 }, (_, index) => (
        <PosterCardSkeleton key={index} />
      ))}
    </div>
  )
}

function SectionHeader({
  icon: Icon,
  title,
  onMore,
}: {
  icon?: typeof Clapperboard
  title: string
  onMore: () => void
}): React.JSX.Element {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        {Icon ? <Icon className="text-primary" size={19} /> : null}
        <h2 className="text-foreground text-xl font-semibold tracking-tight">{title}</h2>
      </div>
      <div className="group flex cursor-pointer items-center" onClick={onMore}>
        <button
          className="text-muted-foreground group-hover:text-primary focus-visible:ring-ring rounded-md text-sm font-medium outline-none focus-visible:ring-2"
          type="button"
        >
          查看更多
        </button>
        <ChevronRight className="text-muted-foreground group-hover:text-primary" size={16} />
      </div>
    </div>
  )
}

function RecentPlayCard({
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
        <MediaPoster
          className="aspect-[2/3]"
          poster={item.poster}
          title={item.title}
          overlay={
            <div className="bg-background/80 text-foreground flex size-10 items-center justify-center rounded-full shadow-sm backdrop-blur">
              <Play fill="currentColor" size={17} />
            </div>
          }
        />
        <div className="mt-3 min-w-0">
          <h3 className="text-foreground truncate text-[15px] font-semibold">{item.title}</h3>
          <p className="text-muted-foreground mt-1 truncate text-sm">
            {item.sourceName} · {item.episodeName}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <div className="bg-muted h-1 min-w-0 flex-1 overflow-hidden rounded-full">
              <div className="bg-primary h-full rounded-full" style={{ width: progress }} />
            </div>
            <span className="text-muted-foreground shrink-0 text-xs font-medium">已看 {progress}</span>
          </div>
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

function RecommendationCard({ item, onClick }: { item: RecommendationItem; onClick: () => void }): React.JSX.Element {
  return (
    <button
      className="group focus-visible:ring-ring focus-visible:ring-offset-background grid min-w-0 grid-rows-[auto_auto] self-start rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      type="button"
      onClick={onClick}
    >
      <div className="relative">
        <MediaPoster className="aspect-[2/3]" poster={item.poster} title={item.title} />
        {item.isNew ? (
          <span className="bg-primary text-primary-foreground absolute top-2 right-2 rounded-md px-2 py-1 text-xs font-semibold shadow-sm">
            新
          </span>
        ) : null}
      </div>
      <div className="mt-3 grid min-w-0 grid-rows-[1.25rem_1.25rem] gap-2">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h3 className="text-foreground min-w-0 truncate text-[15px] font-semibold">{item.title}</h3>
          <span className="text-primary shrink-0 text-sm font-semibold">{formatRating(item.rating)}</span>
        </div>
        <HomeStarRating item={item} />
      </div>
    </button>
  )
}

function HomeStarRating({ item }: { item: RecommendationItem }): React.JSX.Element | null {
  const filledStars = getFilledStars(item)

  if (filledStars === undefined) {
    return null
  }

  return (
    <div
      aria-label={`星级 ${filledStars} / 5`}
      aria-valuemax={5}
      aria-valuemin={0}
      aria-valuenow={filledStars}
      className="flex items-center gap-1"
      role="meter"
    >
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          className={index < filledStars ? 'fill-yellow-400 text-yellow-400' : 'fill-secondary text-secondary'}
          size={16}
        />
      ))}
    </div>
  )
}

function getFilledStars(item: RecommendationItem): number | undefined {
  if (typeof item.ratingStarCount === 'number' && item.ratingStarCount > 0) {
    const starCount = item.ratingStarCount <= 5 ? item.ratingStarCount : item.ratingStarCount / 10
    return Math.min(Math.max(Math.round(starCount), 0), 5)
  }

  if (typeof item.rating === 'number' && item.rating > 0) {
    return Math.min(Math.max(Math.round(item.rating / 2), 0), 5)
  }

  return undefined
}

function formatRating(rating: number | undefined): string {
  return typeof rating === 'number' && rating > 0 ? rating.toFixed(1) : '暂无评分'
}

function EmptyShelf({ description, title }: { description: string; title: string }): React.JSX.Element {
  return (
    <div className="border-input bg-card flex h-36 items-center justify-center rounded-xl border border-dashed">
      <div className="text-center">
        <div className="text-foreground text-sm font-semibold">{title}</div>
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      </div>
    </div>
  )
}
