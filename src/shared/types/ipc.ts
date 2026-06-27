import type {
  SourceSubscriptionResult,
  VodSourceConfig,
  VodSourceExportResult,
  VodSourceFileResult,
  VodSourceImportPreview,
  VodSourceImportResult,
  VodSourceInput,
} from './source'
import type { AppDataClientPayload, AppDataExportResult, AppDataImportResult } from './app-data'
import type { AppSettings } from './settings'
import type { FavoriteInput, FavoriteItem } from './favorite'
import type {
  LivePlaylist,
  LiveSourceConfig,
  LiveSourceExportResult,
  LiveSourceFileResult,
  LiveSourceImportPreview,
  LiveSourceImportResult,
  LiveSourceInput,
} from './live'
import type { RecentPlayInput, RecentPlayItem } from './recent'
import type { SearchEvent } from './search'
import type { MediaProbeInput, MediaProbeResult, RecommendationItem } from './vod'
import type { UpdateCheckResult } from './update'

export interface HomeData {
  recentPlays: RecentPlayItem[]
  recommendations: RecommendationItem[]
}

export interface HotRecommendationsRequest {
  category: RecommendationItem['category']
  type: HotRecommendationType
  start: number
  limit: number
}

export type HotRecommendationType =
  | '全部'
  | '华语'
  | '欧美'
  | '韩国'
  | '日本'
  | 'tv'
  | 'tv_domestic'
  | 'tv_american'
  | 'tv_japanese'
  | 'tv_korean'
  | 'tv_animation'
  | 'tv_documentary'
  | 'show'
  | 'show_domestic'
  | 'show_foreign'

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
    reorder: (sourceIds: string[]) => Promise<VodSourceConfig[]>
    delete: (id: string) => Promise<void>
    clear: () => Promise<void>
    previewImport: (payload: unknown) => Promise<VodSourceImportPreview>
    confirmImport: (payload: unknown) => Promise<VodSourceImportResult>
    importFromFile: () => Promise<VodSourceFileResult>
    exportToFile: () => Promise<VodSourceExportResult>
    syncSubscription: (url: string) => Promise<SourceSubscriptionResult>
  }
  liveSources: {
    list: () => Promise<LiveSourceConfig[]>
    create: (input: LiveSourceInput) => Promise<LiveSourceConfig>
    update: (id: string, input: LiveSourceInput) => Promise<LiveSourceConfig>
    reorder: (sourceIds: string[]) => Promise<LiveSourceConfig[]>
    delete: (id: string) => Promise<void>
    clear: () => Promise<void>
    previewImport: (payload: unknown) => Promise<LiveSourceImportPreview>
    confirmImport: (payload: unknown) => Promise<LiveSourceImportResult>
    importFromFile: () => Promise<LiveSourceFileResult>
    exportToFile: () => Promise<LiveSourceExportResult>
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
    probeMedia: (input: MediaProbeInput) => Promise<MediaProbeResult>
    onSearchEvent: (listener: (event: SearchEvent) => void) => () => void
  }
  live: {
    loadPlaylist: (url: string) => Promise<LivePlaylist>
  }
  media: {
    getProxyBaseUrl: () => Promise<string>
  }
  settings: {
    get: () => Promise<AppSettings>
    update: (input: Partial<AppSettings>) => Promise<AppSettings>
    initializeAppData: () => Promise<AppSettings>
    exportAppData: (clientData: AppDataClientPayload) => Promise<AppDataExportResult>
    importAppData: () => Promise<AppDataImportResult>
  }
  updates: {
    getCurrentVersion: () => Promise<string>
    check: () => Promise<UpdateCheckResult>
  }
  window: {
    isMaximized: () => Promise<boolean>
    toggleMaximize: () => Promise<boolean>
  }
  shell: {
    openExternal: (url: string) => Promise<void>
  }
}
