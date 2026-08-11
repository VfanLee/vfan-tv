import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import type { SearchEvent, SubscriptionNetworkMode } from '@shared/types'
import { createDatabase } from '../infrastructure/database/client'
import { HttpClient } from '../infrastructure/http/http-client'
import { ContentNetworkService } from '../infrastructure/network/content-network.service'
import { configureDoubanSessionHeaders, DoubanService } from '../modules/home/douban.service'
import { HomeService } from '../modules/home/home.service'
import { FavoriteRepository } from '../modules/library/favorite.repository'
import { RecentPlayRepository } from '../modules/library/recent-play.repository'
import { IptvPlaylistService } from '../modules/iptv-sources/iptv-playlist.service'
import { IptvCacheRepository } from '../modules/iptv-sources/iptv-cache.repository'
import { IptvCatalogService } from '../modules/iptv-sources/iptv-catalog.service'
import { IptvEpgService } from '../modules/iptv-sources/iptv-epg.service'
import { IptvPlaybackService } from '../modules/iptv-sources/iptv-playback.service'
import { IptvSourceRepository } from '../modules/iptv-sources/iptv-source.repository'
import { IptvSourceService } from '../modules/iptv-sources/iptv-source.service'
import { MediaPlaybackTargetService } from '../modules/media/media-playback-target.service'
import { MediaProxyServer } from '../modules/media/media-proxy-server'
import { probeMediaSource } from '../modules/media/media-probe.service'
import { SearchTaskManager } from '../modules/media/search-task-manager'
import { VodSearchService } from '../modules/media/vod-search.service'
import { VodCatalogService } from '../modules/media/vod-catalog.service'
import { SourceService } from '../modules/sources/source.service'
import { VodSourceRepository } from '../modules/sources/vod-source.repository'
import { SettingsRepository } from '../modules/settings/settings.repository'
import { SettingsService } from '../modules/settings/settings.service'
import { UpdateService } from '../modules/updates/update.service'
import { configureRadioSessionHeaders, RadioService } from '../modules/radio/radio.service'
import { broadcastUpdateEvent } from '../ipc/broadcast'

// main 进程唯一的组合根：在此处集中装配依赖，领域模块不得自行创建全局实例。
export interface ApplicationContext {
  db: ReturnType<typeof createDatabase>
  getMainWindow: () => BrowserWindow | null
  setMainWindow: (window: BrowserWindow | null) => void
  repositories: {
    source: VodSourceRepository
    iptvSource: IptvSourceRepository
    iptvCache: IptvCacheRepository
    recentPlay: RecentPlayRepository
    favorite: FavoriteRepository
  }
  services: {
    source: SourceService
    iptvSource: IptvSourceService
    iptvPlaylist: IptvPlaylistService
    iptvCatalog: IptvCatalogService
    iptvEpg: IptvEpgService
    iptvPlayback: IptvPlaybackService
    home: HomeService
    douban: DoubanService
    settings: SettingsService
    network: ContentNetworkService
    mediaProxy: MediaProxyServer
    mediaPlaybackTarget: MediaPlaybackTargetService
    vodSearch: VodSearchService
    vodCatalog: VodCatalogService
    updates: UpdateService
    radio: RadioService
  }
  utilities: {
    subscriptionHttpClients: Record<SubscriptionNetworkMode, HttpClient>
    probeMediaSource: (
      input: Parameters<typeof probeMediaSource>[0],
      source?: Parameters<typeof probeMediaSource>[2],
    ) => ReturnType<typeof probeMediaSource>
  }
}

export async function createApplicationContext(): Promise<ApplicationContext> {
  const db = createDatabase()
  const source = new VodSourceRepository(db)
  const iptvSource = new IptvSourceRepository(db)
  const iptvCache = new IptvCacheRepository(db)
  const recentPlay = new RecentPlayRepository(db)
  const favorite = new FavoriteRepository(db)
  const settings = new SettingsService(new SettingsRepository(db))
  const network = new ContentNetworkService()
  await network.initialize(settings.get().network)
  configureDoubanSessionHeaders(network.getContext('douban').session)
  configureRadioSessionHeaders(network.getContext('radio').session)
  const iptvHttpClient = new HttpClient(network, 'iptv')
  const vodHttpClient = new HttpClient(network, 'vod')
  const radioHttpClient = new HttpClient(network, 'radio')
  const subscriptionHttpClients: Record<SubscriptionNetworkMode, HttpClient> = {
    direct: new HttpClient(network, 'subscriptionDirect'),
    system: new HttpClient(network, 'subscriptionSystem'),
  }
  // 搜索事件只属于主窗口；更新事件广播给所有应用窗口，业务服务不直接持有 BrowserWindow。
  let mainWindow: BrowserWindow | null = null
  const getMainWindow = (): BrowserWindow | null => mainWindow
  const emitSearchEvent = (event: SearchEvent): void =>
    mainWindow?.webContents.send(IPC_CHANNELS.vod.searchEvent, event)
  const emitUpdateEvent: ConstructorParameters<typeof UpdateService>[0] = broadcastUpdateEvent
  const sourceService = new SourceService(source, vodHttpClient)
  const douban = new DoubanService(network)
  const mediaProxy = new MediaProxyServer(network)
  const mediaPlaybackTarget = new MediaPlaybackTargetService(mediaProxy, network)
  const iptvPlaylist = new IptvPlaylistService(iptvHttpClient)
  const iptvCatalog = new IptvCatalogService(iptvSource, iptvCache, iptvPlaylist)

  return {
    db,
    getMainWindow,
    setMainWindow: (window) => {
      mainWindow = window
    },
    repositories: { source, iptvSource, iptvCache, recentPlay, favorite },
    services: {
      source: sourceService,
      iptvSource: new IptvSourceService(iptvSource, iptvCache),
      iptvPlaylist,
      iptvCatalog,
      iptvEpg: new IptvEpgService(iptvHttpClient, settings, iptvCatalog, iptvCache),
      iptvPlayback: new IptvPlaybackService(iptvSource, iptvCatalog, mediaPlaybackTarget),
      home: new HomeService(recentPlay, douban),
      douban,
      settings,
      network,
      mediaProxy,
      mediaPlaybackTarget,
      vodSearch: new VodSearchService(sourceService, vodHttpClient, new SearchTaskManager(), emitSearchEvent),
      vodCatalog: new VodCatalogService(sourceService, vodHttpClient),
      updates: new UpdateService(emitUpdateEvent, network),
      radio: new RadioService(radioHttpClient, mediaProxy, network),
    },
    utilities: {
      subscriptionHttpClients,
      probeMediaSource: (input, source) => probeMediaSource(input, network, source),
    },
  }
}
