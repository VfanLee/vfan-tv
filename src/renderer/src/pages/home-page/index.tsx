import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ChevronRight, Star, Trash2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { RecentPlayItem, RecommendationItem } from '@shared/types'
import { ConfirmDialog, MediaPoster, PosterCardSkeleton, PosterPlayOverlay } from '@renderer/components'
import { useRecentPlays } from '@renderer/hooks'
import { categorySections } from '@renderer/services/api'
import { recentPlayToVodSearchResult } from '@renderer/services/playback'
import { useAppDataStore } from '@renderer/stores/app-data'
import { useSearchContextStore } from '@renderer/stores/search-context'
import { categoryIcons } from '@renderer/utils/category-icons'

export function HomePage(): React.JSX.Element {
  const navigate = useNavigate()
  const setContext = useSearchContextStore((state) => state.setContext)
  const homeData = useAppDataStore((state) => state.homeData)
  const isLoading = useAppDataStore((state) => !state.homeInitialized && !state.homeErrorMessage)
  const loadHome = useAppDataStore((state) => state.loadHome)
  const { recentPlays, isLoading: recentLoading, deleteRecentPlay } = useRecentPlays({ limit: 20 })
  const [pendingDeleteRecent, setPendingDeleteRecent] = useState<RecentPlayItem>()

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
    <div className="bg-background text-foreground min-h-full px-10 py-7">
      <div className="mx-auto max-w-[1500px]">
        <section className="mb-11">
          <SectionHeader title="最近播放" onMore={() => navigate('/recent')} />
          {recentLoading ? (
            <HomeShelfSkeleton />
          ) : recentPlays.length > 0 ? (
            <div className="no-scrollbar grid auto-cols-[220px] grid-flow-col items-start gap-6 overflow-x-auto pb-4">
              {recentPlays.map((item) => (
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
                  onDelete={() => setPendingDeleteRecent(item)}
                />
              ))}
            </div>
          ) : (
            <EmptyShelf
              description={recentLoading ? '正在加载最近播放' : '播放过的视频会出现在这里'}
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
                <SectionHeader icon={Icon} title={section.title} onMore={() => navigate(`/hot/${section.key}`)} />
                {isLoading ? (
                  <HomeShelfSkeleton />
                ) : items.length > 0 ? (
                  <div className="no-scrollbar grid auto-cols-[220px] grid-flow-col items-start gap-6 overflow-x-auto pb-4">
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
      {pendingDeleteRecent ? (
        <ConfirmDialog
          confirmText="删除"
          description={`确定删除「${pendingDeleteRecent.title}」的播放记录吗？`}
          title="删除播放记录"
          onCancel={() => setPendingDeleteRecent(undefined)}
          onConfirm={async () => {
            await handleDeleteRecent(pendingDeleteRecent)
            setPendingDeleteRecent(undefined)
          }}
        />
      ) : null}
    </div>
  )
}

function HomeShelfSkeleton(): React.JSX.Element {
  return (
    <div className="grid grid-cols-[repeat(6,220px)] gap-6 overflow-hidden pb-4">
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
  icon?: LucideIcon
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
          className="text-muted-foreground group-hover:text-primary focus-visible:ring-ring rounded-xl text-sm font-medium outline-none focus-visible:ring-2"
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
    <div className="group relative w-[220px] min-w-0 self-start rounded-xl">
      <button
        className="focus-visible:ring-ring focus-visible:ring-offset-background w-full rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        type="button"
        onClick={onClick}
      >
        <MediaPoster className="aspect-[2/3]" poster={item.poster} title={item.title} overlay={<PosterPlayOverlay />} />
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

function RecommendationCard({ item, onClick }: { item: RecommendationItem; onClick: () => void }): React.JSX.Element {
  return (
    <button
      className="group focus-visible:ring-ring focus-visible:ring-offset-background grid min-w-0 grid-rows-[auto_auto] self-start rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      type="button"
      onClick={onClick}
    >
      <div className="relative">
        <MediaPoster className="aspect-[2/3]" poster={item.poster} showHoverScrim={false} title={item.title} />
        {item.isNew ? (
          <span className="bg-primary text-primary-foreground absolute top-2 right-2 rounded-xl px-2 py-1 text-xs font-semibold shadow-sm">
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
    <div className="border-input bg-card flex h-36 items-center justify-center rounded-xl">
      <div className="text-center">
        <div className="text-muted-foreground text-sm font-semibold">{title}</div>
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      </div>
    </div>
  )
}
