import { create } from 'zustand'
import type { HomeData, HotRecommendationsPage, RecommendationItem } from '@shared/types'
import { getHomeData, getHotRecommendationsPage } from '@renderer/services/api'

const hotPageSize = 24
const categories: RecommendationItem['category'][] = ['movie', 'tv', 'show']

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
  hot: Record<RecommendationItem['category'], HotCategoryCache>
  initialize: () => Promise<void>
  loadHome: () => Promise<void>
  loadHotPage: (category: RecommendationItem['category']) => Promise<void>
  removeRecentPlayFromCache: (title: string) => void
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
const hotRequests = new Map<RecommendationItem['category'], Promise<void>>()

export const useAppDataStore = create<AppDataState>((set, get) => ({
  homeData: { recentPlays: [], recommendations: [] },
  homeErrorMessage: '',
  homeInitialized: false,
  homeLoading: false,
  hot: {
    movie: emptyHotCache(),
    tv: emptyHotCache(),
    show: emptyHotCache(),
  },
  initialize: async () => {
    await Promise.allSettled([get().loadHome(), ...categories.map((category) => get().loadHotPage(category))])
  },
  loadHome: async () => {
    if (get().homeInitialized) return
    if (homeRequest) return homeRequest

    set({ homeLoading: true, homeErrorMessage: '' })
    homeRequest = getHomeData()
      .then((homeData) => set({ homeData, homeInitialized: true }))
      .catch((error: unknown) => set({ homeErrorMessage: toErrorMessage(error) }))
      .finally(() => {
        set({ homeLoading: false })
        homeRequest = undefined
      })

    return homeRequest
  },
  loadHotPage: async (category) => {
    const current = get().hot[category]
    if (!current.hasMore || hotRequests.has(category)) return hotRequests.get(category)

    set((state) => ({
      hot: { ...state.hot, [category]: { ...state.hot[category], errorMessage: '', isLoading: true } },
    }))

    const request = getHotRecommendationsPage({ category, start: current.nextStart, limit: hotPageSize })
      .then((page) => {
        set((state) => ({
          hot: {
            ...state.hot,
            [category]: mergeHotPage(state.hot[category], page),
          },
        }))
      })
      .catch((error: unknown) => {
        set((state) => ({
          hot: {
            ...state.hot,
            [category]: { ...state.hot[category], errorMessage: toErrorMessage(error) },
          },
        }))
      })
      .finally(() => {
        hotRequests.delete(category)
        set((state) => ({
          hot: { ...state.hot, [category]: { ...state.hot[category], isLoading: false } },
        }))
      })

    hotRequests.set(category, request)
    return request
  },
  removeRecentPlayFromCache: (title) => {
    set((state) => ({
      homeData: {
        ...state.homeData,
        recentPlays: state.homeData.recentPlays.filter((item) => item.title !== title),
      },
    }))
  },
}))

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
