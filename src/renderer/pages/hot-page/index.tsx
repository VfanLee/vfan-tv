import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import type { HotRecommendationType, RecommendationItem } from '@shared/types'
import { MediaPoster, PosterCardSkeleton } from '@renderer/components'
import { categorySections } from '@renderer/constants'
import { useAppDataStore } from '@/stores'
import { SegmentedTabs } from '@/ui'
import { getHotCacheKey, getHotCategorySection } from '@/utils'

/** 豆瓣推荐分类对应的查询参数名 */
const CATEGORY_PARAM = 'doubanCategory'
/** 豆瓣推荐类型对应的查询参数名 */
const TYPE_PARAM = 'doubanType'

/** 渲染豆瓣热门推荐内容 */
export function HotPage(): React.JSX.Element {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedCategory = searchParams.get(CATEGORY_PARAM) ?? undefined
  const activeSection = getHotCategorySection(requestedCategory)
  const activeType = readType(activeSection, searchParams.get(TYPE_PARAM))
  /** 当前豆瓣分类与类型对应的缓存键 */
  const cacheKey = getHotCacheKey(activeSection.key, activeType)
  /** 当前豆瓣推荐分类对应的缓存状态 */
  const categoryCache = useAppDataStore((state) => state.hot[cacheKey])
  const loadHotPage = useAppDataStore((state) => state.loadHotPage)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const selectedTypesRef = useRef<Record<string, HotRecommendationType>>(
    Object.fromEntries(
      categorySections.map((section) => [
        section.key,
        section.key === activeSection.key ? activeType : section.defaultType,
      ]),
    ),
  )
  const showInitialSkeleton = !categoryCache.initialized && !categoryCache.errorMessage

  /** 记录每个豆瓣分类最后选择的推荐类型 */
  useEffect(() => {
    selectedTypesRef.current[activeSection.key] = activeType
  }, [activeSection.key, activeType])

  /** 将有效豆瓣分类和类型同步到查询参数 */
  useEffect(() => {
    if (requestedCategory === activeSection.key && searchParams.get(TYPE_PARAM) === activeType) return
    const next = new URLSearchParams(searchParams)
    next.set(CATEGORY_PARAM, activeSection.key)
    next.set(TYPE_PARAM, activeType)
    setSearchParams(next, { replace: true })
  }, [activeSection.key, activeType, requestedCategory, searchParams, setSearchParams])

  /** 加载当前豆瓣分类的首批推荐内容 */
  useEffect(() => {
    if (!categoryCache.initialized) void loadHotPage(activeSection.key, activeType)
  }, [activeSection.key, activeType, categoryCache.initialized, loadHotPage])

  /** 监听列表底部并加载下一页推荐内容 */
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !categoryCache.hasMore || categoryCache.isLoading || categoryCache.errorMessage) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadHotPage(activeSection.key, activeType)
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

  /** 选择分类 */
  const selectCategory = (category: RecommendationItem['category']): void => {
    const section = getHotCategorySection(category)
    const type = readType(section, selectedTypesRef.current[category] ?? section.defaultType)
    const next = new URLSearchParams(searchParams)
    next.set(CATEGORY_PARAM, category)
    next.set(TYPE_PARAM, type)
    setSearchParams(next)
  }

  /** 选择类型 */
  const selectType = (type: HotRecommendationType): void => {
    selectedTypesRef.current[activeSection.key] = type
    const next = new URLSearchParams(searchParams)
    next.set(CATEGORY_PARAM, activeSection.key)
    next.set(TYPE_PARAM, type)
    setSearchParams(next)
  }

  return (
    <div className="text-foreground min-h-full bg-transparent px-5 py-7 sm:px-8 lg:px-10">
      <div className="mx-auto w-full max-w-[1800px]">
        <header className="mb-7">
          <p className="text-primary text-xs font-bold tracking-[0.18em]">DOUBAN DISCOVERY</p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-[-0.035em] sm:text-4xl">豆瓣热门</h1>
              <p className="text-muted-foreground mt-2 text-sm">按内容类型与地区发现近期热门作品</p>
            </div>
          </div>
        </header>

        <section className="border-border bg-card/88 mb-8 rounded-[24px] border p-3 shadow-sm backdrop-blur sm:p-4">
          <SegmentedTabs
            ariaLabel="豆瓣内容类型"
            className="max-w-full flex-wrap border-0 bg-transparent p-0 shadow-none"
            items={categorySections.map((section) => ({
              value: section.key,
              label: section.title,
            }))}
            value={activeSection.key}
            onValueChange={selectCategory}
          />
          <div className="border-border mt-3 border-t pt-3">
            <SegmentedTabs
              ariaLabel={`${activeSection.title}筛选`}
              className="max-w-full flex-wrap border-0 bg-transparent p-0 shadow-none"
              items={activeSection.filters.map((filter) => ({ value: filter.value, label: filter.label }))}
              value={activeType}
              onValueChange={selectType}
            />
          </div>
        </section>

        <section aria-labelledby="douban-results-heading">
          <div className="mb-5 flex items-center justify-between gap-4">
            <h2 id="douban-results-heading" className="text-2xl font-bold tracking-tight">
              热门{activeSection.title}
            </h2>
            <span className="text-muted-foreground text-sm">
              {activeSection.filters.find((item) => item.value === activeType)?.label}
            </span>
          </div>

          <div className="grid grid-cols-2 items-start gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
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
                className="border-border bg-card hover:bg-accent focus-visible:ring-ring rounded-xl border px-4 py-2 outline-none focus-visible:ring-2"
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
        </section>
      </div>
    </div>
  )
}

/** 渲染热门卡片 */
function HotCard({ item, onClick }: { item: RecommendationItem; onClick: () => void }): React.JSX.Element {
  const subtitle = formatCardSubtitle(item.subtitle)

  return (
    <button
      className="group focus-visible:ring-ring focus-visible:ring-offset-background min-w-0 self-start rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      type="button"
      onClick={onClick}
    >
      <MediaPoster
        className="aspect-[2/3]"
        poster={item.poster}
        showHoverScrim={false}
        sourceType="douban"
        title={item.title}
      />
      <div className="mt-3 min-w-0">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-foreground min-w-0 truncate text-[15px] font-semibold">{item.title}</h3>
          <span className="text-primary shrink-0 text-sm font-semibold">{formatRating(item.rating)}</span>
        </div>
        {subtitle ? <HotSubtitle subtitle={subtitle} /> : null}
      </div>
    </button>
  )
}

/** 渲染热门副标题 */
function HotSubtitle({ subtitle }: { subtitle: FormattedSubtitle }): React.JSX.Element {
  return (
    <div className="mt-2 min-h-[3.75rem] space-y-1">
      {subtitle.meta ? <p className="text-muted-foreground truncate text-xs leading-5">{subtitle.meta}</p> : null}
      {subtitle.genre ? <p className="text-muted-foreground truncate text-xs leading-5">{subtitle.genre}</p> : null}
      {subtitle.credits ? <p className="text-muted-foreground truncate text-xs leading-5">{subtitle.credits}</p> : null}
    </div>
  )
}

interface FormattedSubtitle {
  meta?: string
  genre?: string
  credits?: string
}

/** 格式化卡片副标题 */
function formatCardSubtitle(subtitle?: string): FormattedSubtitle | undefined {
  if (!subtitle) return undefined
  const parts = subtitle
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return undefined

  const [date, region, genre, director, actors, ...restParts] = parts
  const meta = [date, region].filter(Boolean).join(' · ')
  const credits = [...splitPeople(director), ...[actors, ...restParts].flatMap(splitPeople)].join(' / ')
  return { meta: meta || undefined, genre, credits: credits || undefined }
}

/** 将空格分隔的人名文本转换为人名数组 */
function splitPeople(value?: string): string[] {
  return value
    ? value
        .split(/\s+/)
        .map((part) => part.trim())
        .filter(Boolean)
    : []
}

/** 读取有效推荐类型，无效时返回当前分类的默认类型 */
function readType(section: ReturnType<typeof getHotCategorySection>, type: string | null): HotRecommendationType {
  return section.filters.find((item) => item.value === type)?.value ?? section.defaultType
}

/** 将有效评分格式化为一位小数，无评分时返回占位文案 */
function formatRating(rating: number | undefined): string {
  return typeof rating === 'number' && rating > 0 ? rating.toFixed(1) : '暂无评分'
}
