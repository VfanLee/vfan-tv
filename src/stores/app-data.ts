import { create } from 'zustand'
import { uniqBy } from 'es-toolkit/array'
import type { HomeData, HotRecommendationType, HotRecommendationsPage, RecommendationItem } from '@/types'
import { categorySections } from '@/constants'
import { getHomeData, getHotRecommendationsPage } from '@/platform/api'
import { getHotCacheKey } from '@/utils'
import { isRecommendationCacheExpired } from '@/platform/cache/recommendation-cache'

const hotPageSize = 24

// 首页数据按分类独立缓存，避免切换标签时重复请求已加载的分页结果。
interface HotCategoryCache {
  errorMessage: string
  hasMore: boolean
  initialized: boolean
  isLoading: boolean
  isRefreshing: boolean
  fetchedAt: number | null
  failedAction?: 'refresh' | 'more'
  items: RecommendationItem[]
  nextStart: number
}

interface AppDataState {
  homeData: HomeData
  homeErrorMessage: string
  homeInitialized: boolean
  homeLoading: boolean
  hot: Record<string, HotCategoryCache>
  cacheRevision: number
  initialize: () => Promise<void>
  loadHome: () => Promise<void>
  loadHotPage: (category: RecommendationItem['category'], type: HotRecommendationType) => Promise<void>
  visitHotCategory: (category: RecommendationItem['category'], type: HotRecommendationType) => Promise<void>
  retryHotCategory: (category: RecommendationItem['category'], type: HotRecommendationType) => Promise<void>
  clearRecommendationCache: () => void
}

/** 创建未加载的热门分类缓存 */
const emptyHotCache = (): HotCategoryCache => ({
  errorMessage: '',
  hasMore: true,
  initialized: false,
  isLoading: false,
  isRefreshing: false,
  fetchedAt: null,
  items: [],
  nextStart: 0,
})

let homeRequest: Promise<void> | undefined
const hotRequests = new Map<string, { action: 'refresh' | 'more'; promise: Promise<void> }>()

export const useAppDataStore = create<AppDataState>((set, get) => ({
  homeData: { recentPlays: [], recommendations: [] },
  homeErrorMessage: '',
  homeInitialized: false,
  homeLoading: false,
  hot: createHotCache(),
  cacheRevision: 0,
  initialize: async () => {
    await Promise.allSettled([
      get().loadHome(),
      ...categorySections.map((section) => get().visitHotCategory(section.key, section.defaultType)),
    ])
  },
  loadHome: async () => {
    if (get().homeInitialized) return
    // 组件并发挂载时复用同一请求，避免首页接口被重复调用。
    if (homeRequest) return homeRequest

    set({ homeLoading: true, homeErrorMessage: '' })
    const revision = get().cacheRevision
    homeRequest = getHomeData()
      .then(({ recommendations }) => {
        if (get().cacheRevision === revision)
          set({ homeData: { recentPlays: [], recommendations }, homeInitialized: true })
      })
      .catch((error: unknown) => {
        if (get().cacheRevision === revision) set({ homeErrorMessage: toErrorMessage(error) })
      })
      .finally(() => {
        if (get().cacheRevision !== revision) return
        set({ homeLoading: false })
        homeRequest = undefined
      })

    return homeRequest
  },
  loadHotPage: async (category, type) => {
    const current = get().hot[getHotCacheKey(category, type)]
    if (!current.initialized || !current.hasMore || current.errorMessage) return
    return requestHotCategory(category, type, 'more')
  },
  visitHotCategory: async (category, type) => {
    const key = getHotCacheKey(category, type)
    let current = get().hot[key]
    if (current.fetchedAt !== null && !isRecommendationCacheExpired(current.fetchedAt)) return
    const existing = hotRequests.get(key)
    if (existing?.action === 'refresh') return existing.promise
    if (existing) {
      const revision = get().cacheRevision
      await existing.promise
      if (get().cacheRevision !== revision) return
      current = get().hot[key]
      if (current.fetchedAt !== null && !isRecommendationCacheExpired(current.fetchedAt)) return
    }
    return requestHotCategory(category, type, 'refresh')
  },
  retryHotCategory: async (category, type) => {
    const current = get().hot[getHotCacheKey(category, type)]
    return requestHotCategory(category, type, current.failedAction ?? 'refresh')
  },
  clearRecommendationCache: () => {
    hotRequests.clear()
    homeRequest = undefined
    set((state) => ({
      hot: createHotCache(),
      cacheRevision: state.cacheRevision + 1,
      homeData: { recentPlays: [], recommendations: [] },
      homeInitialized: false,
      homeLoading: false,
      homeErrorMessage: '',
    }))
  },
}))

/** 执行首批更新或追加分页，同分类并发复用且清理后的旧请求不回写 */
function requestHotCategory(
  category: RecommendationItem['category'],
  type: HotRecommendationType,
  action: 'refresh' | 'more',
): Promise<void> {
  const cacheKey = getHotCacheKey(category, type)
  const existing = hotRequests.get(cacheKey)
  if (existing) return existing.promise
  const store = useAppDataStore
  const current = store.getState().hot[cacheKey]
  const revision = store.getState().cacheRevision
  /** 判断当前请求是否仍属于有效缓存版本 */
  const isCurrent = (): boolean => revision === store.getState().cacheRevision
  /** 仅替换当前分类，保留其他分类的独立加载状态 */
  const publish = (update: Partial<HotCategoryCache>): void => {
    if (!isCurrent()) return
    store.setState((state) => ({ hot: { ...state.hot, [cacheKey]: { ...state.hot[cacheKey], ...update } } }))
  }
  const request = Promise.resolve().then(async () => {
    if (!isCurrent()) return
    try {
      const page = await getHotRecommendationsPage({
        category,
        type,
        start: action === 'refresh' ? 0 : current.nextStart,
        limit: hotPageSize,
      })
      if (!isCurrent()) return
      const base = action === 'refresh' ? emptyHotCache() : current
      publish({ ...mergeHotPage(base, page), fetchedAt: action === 'refresh' ? Date.now() : current.fetchedAt })
    } catch (error) {
      publish({ errorMessage: toErrorMessage(error), failedAction: action })
    } finally {
      if (hotRequests.get(cacheKey)?.promise === request) hotRequests.delete(cacheKey)
      publish({ isLoading: false, isRefreshing: false })
    }
  })
  hotRequests.set(cacheKey, { action, promise: request })
  publish({
    errorMessage: '',
    failedAction: undefined,
    isLoading: true,
    isRefreshing: action === 'refresh' && current.initialized,
  })
  return request
}

/** 为所有热门分类和筛选建立独立缓存 */
function createHotCache(): Record<string, HotCategoryCache> {
  return Object.fromEntries(
    categorySections.flatMap((section) =>
      section.filters.map((filter) => [getHotCacheKey(section.key, filter.value), emptyHotCache()]),
    ),
  )
}

/** 合并同一批推荐分页并按分类和影片标识去重 */
function mergeHotPage(current: HotCategoryCache, page: HotRecommendationsPage): HotCategoryCache {
  return {
    ...current,
    hasMore: page.hasMore,
    initialized: true,
    errorMessage: '',
    failedAction: undefined,
    items: uniqBy([...current.items, ...page.items], (item) => `${item.category}-${item.id}`),
    nextStart: page.nextStart,
  }
}

/** 转换可展示的请求错误 */
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
