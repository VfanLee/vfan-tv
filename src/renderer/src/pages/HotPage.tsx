import { useEffect, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import type { HotRecommendationType, RecommendationItem } from '@shared/types'
import { MediaPoster, PosterCardSkeleton } from '@renderer/components'
import { categorySections, getHotCacheKey, getHotCategorySection } from '@renderer/services/api'
import { cn } from '@renderer/lib/utils'
import { useAppDataStore } from '@renderer/stores/app-data'
import { Flame } from 'lucide-react'

export function HotPage(): React.JSX.Element {
  const navigate = useNavigate()
  const { category } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeSection = getHotCategorySection(category)
  const activeType = readType(activeSection, searchParams.get('type'))
  const cacheKey = getHotCacheKey(activeSection.key, activeType)
  const categoryCache = useAppDataStore((state) => state.hot[cacheKey])
  const loadHotPage = useAppDataStore((state) => state.loadHotPage)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const showInitialSkeleton = !categoryCache.initialized && !categoryCache.errorMessage

  useEffect(() => {
    if (!categorySections.some((section) => section.key === category)) {
      navigate('/hot/movie', { replace: true })
    }
  }, [category, navigate])

  useEffect(() => {
    if (searchParams.get('type') !== activeType) {
      setSearchParams({ type: activeType }, { replace: true })
    }
  }, [activeType, searchParams, setSearchParams])

  useEffect(() => {
    if (!categoryCache.initialized) {
      void loadHotPage(activeSection.key, activeType)
    }
  }, [activeSection.key, activeType, categoryCache.initialized, loadHotPage])

  useEffect(() => {
    const sentinel = sentinelRef.current

    if (!sentinel || !categoryCache.hasMore || categoryCache.isLoading || categoryCache.errorMessage) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadHotPage(activeSection.key, activeType)
        }
      },
      { rootMargin: '420px' },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [
    activeSection.key,
    activeType,
    categoryCache.errorMessage,
    categoryCache.hasMore,
    categoryCache.isLoading,
    loadHotPage,
  ])

  return (
    <div className="bg-background text-foreground min-h-full px-10 py-7">
      <div className="mx-auto max-w-[1500px]">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Flame className="text-primary" size={22} />
              <h1 className="text-2xl font-semibold tracking-tight">热门{activeSection.title}</h1>
            </div>
            <p className="text-muted-foreground mt-2 text-sm">
              选择类型浏览豆瓣热门{activeSection.title}，滚动到底部自动加载更多。
            </p>
          </div>
          <div className="border-border bg-card flex flex-wrap rounded-xl border p-1">
            {activeSection.filters.map((filter) => (
              <button
                key={filter.value}
                className={cn(
                  'text-muted-foreground hover:text-foreground focus-visible:ring-ring h-9 rounded-xl px-4 text-sm font-medium outline-none focus-visible:ring-2',
                  activeType === filter.value && 'bg-accent text-primary',
                )}
                type="button"
                onClick={() => setSearchParams({ type: filter.value })}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </header>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] items-start gap-x-6 gap-y-9">
          {categoryCache.items.map((item) => (
            <HotCard
              key={`${item.category}-${item.id}`}
              item={item}
              onClick={() => navigate(`/search?keyword=${encodeURIComponent(item.title)}`)}
            />
          ))}
          {showInitialSkeleton ? Array.from({ length: 12 }, (_, index) => <PosterCardSkeleton key={index} />) : null}
        </div>

        <div ref={sentinelRef} className="text-muted-foreground flex h-24 items-center justify-center text-sm">
          {categoryCache.errorMessage ? (
            <button
              className="border-border bg-card text-muted-foreground hover:text-primary rounded-xl border px-3 py-2"
              type="button"
              onClick={() => void loadHotPage(activeSection.key, activeType)}
            >
              加载失败，点击重试
            </button>
          ) : categoryCache.isLoading || showInitialSkeleton ? (
            '正在加载更多'
          ) : categoryCache.hasMore ? (
            '继续下滑加载更多'
          ) : categoryCache.items.length > 0 ? (
            '已显示全部'
          ) : (
            '暂无热门推荐'
          )}
        </div>
      </div>
    </div>
  )
}

function HotCard({ item, onClick }: { item: RecommendationItem; onClick: () => void }): React.JSX.Element {
  const subtitle = formatCardSubtitle(item.subtitle)

  return (
    <button
      className="focus-visible:ring-ring focus-visible:ring-offset-background min-w-0 self-start rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      type="button"
      onClick={onClick}
    >
      <MediaPoster className="aspect-[2/3]" poster={item.poster} title={item.title} />
      <div className="mt-3 min-w-0">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-foreground min-w-0 truncate text-[15px] font-semibold">{item.title}</h2>
          <span className="text-primary shrink-0 text-sm font-semibold">{formatRating(item.rating)}</span>
        </div>
        {subtitle ? <HotSubtitle subtitle={subtitle} /> : null}
      </div>
    </button>
  )
}

function HotSubtitle({ subtitle }: { subtitle: FormattedSubtitle }): React.JSX.Element {
  return (
    <div className="mt-2 min-h-[3.75rem] space-y-1">
      {subtitle.meta ? (
        <p className="text-muted-foreground truncate text-xs leading-5" title={subtitle.meta}>
          {subtitle.meta}
        </p>
      ) : null}
      {subtitle.genre ? (
        <p className="text-muted-foreground truncate text-xs leading-5" title={subtitle.genre}>
          {subtitle.genre}
        </p>
      ) : null}
      {subtitle.credits ? (
        <p className="text-muted-foreground truncate text-xs leading-5" title={subtitle.credits}>
          {subtitle.credits}
        </p>
      ) : null}
    </div>
  )
}

interface FormattedSubtitle {
  meta?: string
  genre?: string
  credits?: string
}

function formatCardSubtitle(subtitle?: string): FormattedSubtitle | undefined {
  if (!subtitle) {
    return undefined
  }

  const parts = subtitle
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length === 0) {
    return undefined
  }

  const [date, region, genre, director, actors, ...restParts] = parts
  const meta = [date, region].filter(Boolean).join(' · ')
  const credits = formatCredits(director, [actors, ...restParts].filter(Boolean))

  return {
    meta: meta || undefined,
    genre,
    credits: credits || undefined,
  }
}

function formatCredits(director?: string, actorParts: string[] = []): string | undefined {
  return [...splitPeople(director), ...actorParts.flatMap(splitPeople)].join(' / ')
}

function splitPeople(value?: string): string[] {
  if (!value) {
    return []
  }

  return value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function readType(section: ReturnType<typeof getHotCategorySection>, type: string | null): HotRecommendationType {
  const filter = section.filters.find((item) => item.value === type)
  if (filter) {
    return filter.value
  }

  return section.defaultType
}

function formatRating(rating: number | undefined): string {
  return typeof rating === 'number' && rating > 0 ? rating.toFixed(1) : '暂无评分'
}
