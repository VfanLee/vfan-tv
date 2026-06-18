import type {
  VodSourceConfig,
  VodSourceExportResult,
  VodSourceFileResult,
  VodSourceImportPreview,
  VodSourceImportResult,
  VodSourceInput,
} from './source'
import type { AppSettings } from './settings'
import type { FavoriteInput, FavoriteItem } from './favorite'
import type { RecentPlayInput, RecentPlayItem } from './recent'
import type { SearchEvent } from './search'
import type { RecommendationItem } from './vod'
import type { UpdateCheckResult } from './update'

export interface HomeData {
  recentPlays: RecentPlayItem[]
  recommendations: RecommendationItem[]
}

export interface HotRecommendationsRequest {
  category: RecommendationItem['category']
  start: number
  limit: number
}

export interface HotRecommendationsPage {
  items: RecommendationItem[]
  start: number
  limit: number
  nextStart: number
  hasMore: boolean
}

export interface AppApi {
  sources: {
    list: () => Promise<VodSourceConfig[]>
    create: (input: VodSourceInput) => Promise<VodSourceConfig>
    update: (id: string, input: VodSourceInput) => Promise<VodSourceConfig>
    delete: (id: string) => Promise<void>
    previewImport: (payload: unknown) => Promise<VodSourceImportPreview>
    confirmImport: (payload: unknown) => Promise<VodSourceImportResult>
    importFromFile: () => Promise<VodSourceFileResult>
    exportToFile: () => Promise<VodSourceExportResult>
  }
  home: {
    get: () => Promise<HomeData>
    getHot: (input: HotRecommendationsRequest) => Promise<HotRecommendationsPage>
  }
  recent: {
    list: (limit?: number) => Promise<RecentPlayItem[]>
    upsert: (input: RecentPlayInput) => Promise<RecentPlayItem>
    remove: (title: string) => Promise<void>
  }
  favorites: {
    list: () => Promise<FavoriteItem[]>
    isFavorite: (sourceId: string, vodId: string) => Promise<boolean>
    add: (input: FavoriteInput) => Promise<FavoriteItem>
    remove: (sourceId: string, vodId: string) => Promise<void>
  }
  vod: {
    search: (keyword: string) => Promise<{ searchId: string }>
    cancelSearch: (searchId: string) => Promise<void>
    onSearchEvent: (listener: (event: SearchEvent) => void) => () => void
  }
  settings: {
    get: () => Promise<AppSettings>
    update: (input: Partial<AppSettings>) => Promise<AppSettings>
  }
  updates: {
    getCurrentVersion: () => Promise<string>
    check: () => Promise<UpdateCheckResult>
  }
  window: {
    isMaximized: () => Promise<boolean>
    toggleMaximize: () => Promise<boolean>
  }
}
