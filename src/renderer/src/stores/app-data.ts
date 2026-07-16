import { create } from 'zustand'
import type { HomeData, HotRecommendationType, HotRecommendationsPage, RecommendationItem } from '@shared/types'
import { categorySections } from '@renderer/constants'
import { getHomeData, getHotRecommendationsPage } from '@renderer/services/api'
import { getHotCacheKey } from '@/utils'

const hotPageSize = 24

interface HotCategoryCache {
  errorMessage: string
  hasMore: boolean
  initialized: boolean
  isLoading: boolean
  items: RecommendationItem[]
  nextStart: number
}

interface AppDataState {
  homeData: HomeData
  homeErrorMessage: string
  homeInitialized: boolean
  homeLoading: boolean
  hot: Record<string, HotCategoryCache>
  initialize: () => Promise<void>
  loadHome: () => Promise<void>
  loadHotPage: (category: RecommendationItem['category'], type: HotRecommendationType) => Promise<void>
}

const emptyHotCache = (): HotCategoryCache => ({
  errorMessage: '',
  hasMore: true,
  initialized: false,
  isLoading: false,
  items: [],
  nextStart: 0,
})

let homeRequest: Promise<void> | undefined
const hotRequests = new Map<string, Promise<void>>()

export const useAppDataStore = create<AppDataState>((set, get) => ({
  homeData: { recentPlays: [], recommendations: [] },
  homeErrorMessage: '',
  homeInitialized: false,
  homeLoading: false,
  hot: createHotCache(),
  initialize: async () => {
    await Promise.allSettled([
      get().loadHome(),
      ...categorySections.map((section) => get().loadHotPage(section.key, section.defaultType)),
    ])
  },
  loadHome: async () => {
    if (get().homeInitialized) return
    if (homeRequest) return homeRequest

    set({ homeLoading: true, homeErrorMessage: '' })
    homeRequest = getHomeData()
      .then(({ recommendations }) => set({ homeData: { recentPlays: [], recommendations }, homeInitialized: true }))
      .catch((error: unknown) => set({ homeErrorMessage: toErrorMessage(error) }))
      .finally(() => {
        set({ homeLoading: false })
        homeRequest = undefined
      })

    return homeRequest
  },
  loadHotPage: async (category, type) => {
    const cacheKey = getHotCacheKey(category, type)
    const current = get().hot[cacheKey]
    if (!current.hasMore || hotRequests.has(cacheKey)) return hotRequests.get(cacheKey)

    set((state) => ({
      hot: { ...state.hot, [cacheKey]: { ...state.hot[cacheKey], errorMessage: '', isLoading: true } },
    }))

    const request = getHotRecommendationsPage({ category, type, start: current.nextStart, limit: hotPageSize })
      .then((page) => {
        set((state) => ({
          hot: {
            ...state.hot,
            [cacheKey]: mergeHotPage(state.hot[cacheKey], page),
          },
        }))
      })
      .catch((error: unknown) => {
        set((state) => ({
          hot: {
            ...state.hot,
            [cacheKey]: { ...state.hot[cacheKey], errorMessage: toErrorMessage(error) },
          },
        }))
      })
      .finally(() => {
        hotRequests.delete(cacheKey)
        set((state) => ({
          hot: { ...state.hot, [cacheKey]: { ...state.hot[cacheKey], isLoading: false } },
        }))
      })

    hotRequests.set(cacheKey, request)
    return request
  },
}))

function createHotCache(): Record<string, HotCategoryCache> {
  return Object.fromEntries(
    categorySections.flatMap((section) =>
      section.filters.map((filter) => [getHotCacheKey(section.key, filter.value), emptyHotCache()]),
    ),
  )
}

function mergeHotPage(current: HotCategoryCache, page: HotRecommendationsPage): HotCategoryCache {
  const seen = new Set(current.items.map((item) => `${item.category}-${item.id}`))
  const items = [...current.items]

  for (const item of page.items) {
    const key = `${item.category}-${item.id}`
    if (!seen.has(key)) {
      seen.add(key)
      items.push(item)
    }
  }

  return {
    ...current,
    hasMore: page.hasMore,
    initialized: true,
    items,
    nextStart: page.nextStart,
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
