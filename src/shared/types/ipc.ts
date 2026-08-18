import type {
  SourceSubscriptionResult,
  SubscriptionNetworkMode,
  VodSourceConfig,
  VodSourceExportResult,
  VodSourceFileResult,
  VodSourceImportPreview,
  VodSourceImportResult,
  VodSourceInput,
  VodSourceSpeedResult,
} from './source'
import type { AppDataClearSelection, AppDataClientPayload, AppDataExportResult, AppDataImportResult } from './app-data'
import type { AppLogInfo } from './diagnostics'
import type {
  AppSettings,
  NetworkProxyTestInput,
  NetworkProxyTestResult,
  NetworkSettings,
  NetworkStatus,
} from './settings'
import type { FavoriteInput, FavoriteItem } from './favorite'
import type {
  IptvPlaybackTarget,
  IptvPlaylist,
  IptvSourceConfig,
  IptvSourceExportResult,
  IptvSourceFileResult,
  IptvSourceImportPreview,
  IptvSourceImportResult,
  IptvSourceInput,
} from './iptv'
import type { RecentPlayInput, RecentPlayItem } from './recent'
import type {
  MediaImageSourceType,
  MediaPlaybackEvent,
  MediaPlaybackSessionInfo,
  MediaPlaybackTargetInput,
  MediaPlaybackTargetResult,
} from './media'
import type { RadioCategory, RadioChannel, RadioLiveProgram, RadioRegion, RadioSearchResult } from './radio'
import type {
  MiniWindowMoveInput,
  MiniWindowPlaybackContext,
  MiniWindowPlaybackExit,
  MiniWindowResizeInput,
} from './mini-window'
import type { SearchEvent } from './search'
import type {
  MediaProbeInput,
  MediaProbeResult,
  RecommendationItem,
  VodCatalogPage,
  VodCatalogRequest,
  VodSearchResult,
} from './vod'
import type { UpdateCheckResult, UpdateEvent } from './update'

export type SettingsSectionId = 'appearance' | 'subscriptions' | 'vod-sources' | 'iptv' | 'data-management' | 'about'

export type AppDataChangeDomain = 'vod-sources' | 'iptv-sources' | 'settings' | 'app-data'

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
    switchBackup: (id: string, backupUrl: string) => Promise<VodSourceConfig>
    testSpeed: (id: string) => Promise<VodSourceSpeedResult>
    reorder: (sourceIds: string[]) => Promise<VodSourceConfig[]>
    delete: (id: string) => Promise<void>
    clear: () => Promise<void>
    previewImport: (payload: unknown) => Promise<VodSourceImportPreview>
    confirmImport: (payload: unknown) => Promise<VodSourceImportResult>
    importFromFile: () => Promise<VodSourceFileResult>
    exportToFile: () => Promise<VodSourceExportResult>
    syncSubscription: (subscriptionId: string, mode: SubscriptionNetworkMode) => Promise<SourceSubscriptionResult>
    deleteSubscription: (subscriptionId: string) => Promise<void>
  }
  iptvSources: {
    list: () => Promise<IptvSourceConfig[]>
    create: (input: IptvSourceInput) => Promise<IptvSourceConfig>
    update: (id: string, input: IptvSourceInput) => Promise<IptvSourceConfig>
    reorder: (sourceIds: string[]) => Promise<IptvSourceConfig[]>
    delete: (id: string) => Promise<void>
    clear: () => Promise<void>
    previewImport: (payload: unknown) => Promise<IptvSourceImportPreview>
    confirmImport: (payload: unknown) => Promise<IptvSourceImportResult>
    importFromFile: () => Promise<IptvSourceFileResult>
    exportToFile: () => Promise<IptvSourceExportResult>
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
    getCatalogPage: (input: VodCatalogRequest) => Promise<VodCatalogPage>
    getDetail: (sourceId: string, vodId: string) => Promise<VodSearchResult>
    probeMedia: (input: MediaProbeInput) => Promise<MediaProbeResult>
    onSearchEvent: (listener: (event: SearchEvent) => void) => () => void
  }
  iptv: {
    getCatalog: (sourceId: string, force?: boolean) => Promise<IptvPlaylist>
    getPlaybackTarget: (sourceId: string, channelId: string, streamId: string) => Promise<IptvPlaybackTarget>
  }
  radio: {
    getCategories: () => Promise<RadioCategory[]>
    getCategoryChannels: (categoryId: number, page?: number, pageSize?: number) => Promise<RadioChannel[]>
    getChannelDetail: (channelId: number) => Promise<RadioChannel>
    searchChannels: (keyword: string, page?: number, pageSize?: number) => Promise<RadioSearchResult>
    getLivePrograms: (channelIds: number[]) => Promise<RadioLiveProgram[]>
    getRegions: () => Promise<RadioRegion[]>
    getBillboard: (categoryId: number, regionId: number) => Promise<RadioChannel[]>
    getPlaybackUrl: (channelId: number) => Promise<string>
  }
  media: {
    getPlaybackTarget: (input: MediaPlaybackTargetInput) => Promise<MediaPlaybackTargetResult>
    getAssociatedAudioUrl: (mediaSessionId: string, url: string) => Promise<string>
    getImageUrl: (
      sourceType: MediaImageSourceType,
      sourceId: string | undefined,
      url: string,
      baseUrl?: string,
    ) => Promise<string>
    getPlaybackSessionInfo: (mediaSessionId: string) => Promise<MediaPlaybackSessionInfo>
    retainPlaybackSession: (mediaSessionId: string) => Promise<void>
    releasePlaybackSession: (mediaSessionId: string) => Promise<void>
    reportPlaybackEvent: (event: MediaPlaybackEvent) => Promise<void>
  }
  settings: {
    get: () => Promise<AppSettings>
    update: (input: Partial<AppSettings>) => Promise<AppSettings>
    restoreFactorySettings: () => Promise<void>
    clearAppData: (selection: AppDataClearSelection) => Promise<void>
    exportAppData: (clientData: AppDataClientPayload) => Promise<AppDataExportResult>
    importAppData: () => Promise<AppDataImportResult>
  }
  diagnostics: {
    getLogInfo: () => Promise<AppLogInfo>
    revealLogFile: () => Promise<void>
    clearLogs: () => Promise<AppLogInfo>
  }
  network: {
    getStatus: () => Promise<NetworkStatus>
    save: (settings: NetworkSettings) => Promise<NetworkSettings>
    test: (input: NetworkProxyTestInput) => Promise<NetworkProxyTestResult>
  }
  updates: {
    getCurrentVersion: () => Promise<string>
    check: () => Promise<UpdateCheckResult>
    download: () => Promise<void>
    install: () => Promise<void>
    onUpdateEvent: (listener: (event: UpdateEvent) => void) => () => void
  }
  window: {
    openSettingsWindow: (section?: SettingsSectionId) => Promise<void>
    onSettingsSectionChange: (listener: (section: SettingsSectionId) => void) => () => void
    onAppDataChange: (listener: (domain: AppDataChangeDomain) => void) => () => void
    isMaximized: () => Promise<boolean>
    toggleMaximize: () => Promise<boolean>
    quitApp: () => Promise<void>
    restartApp: () => Promise<void>
    enterMiniWindowMode: (context: MiniWindowPlaybackContext) => Promise<void>
    getMiniWindowPlayback: () => Promise<MiniWindowPlaybackContext | undefined>
    updateMiniWindowPlayback: (input: MiniWindowPlaybackExit) => Promise<void>
    resizeMiniWindow: (input: MiniWindowResizeInput) => Promise<void>
    moveMiniWindow: (input: MiniWindowMoveInput) => Promise<void>
    hideMiniWindow: (sessionId: string) => Promise<void>
    getMiniWindowAlwaysOnTop: (sessionId: string) => Promise<boolean>
    setMiniWindowAlwaysOnTop: (sessionId: string, enabled: boolean) => Promise<boolean>
    exitMiniWindowMode: (input: MiniWindowPlaybackExit) => Promise<void>
    onMiniWindowModeExit: (listener: (input: MiniWindowPlaybackExit) => void) => () => void
  }
  shell: {
    openExternal: (url: string) => Promise<void>
  }
}
