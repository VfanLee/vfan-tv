import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import type { SearchEvent } from '@shared/types'
import { createDatabase } from '../infrastructure/database/client'
import { HttpClient } from '../infrastructure/http/http-client'
import { DoubanService } from '../modules/home/douban.service'
import { HomeService } from '../modules/home/home.service'
import { FavoriteRepository } from '../modules/library/favorite.repository'
import { RecentPlayRepository } from '../modules/library/recent-play.repository'
import { LivePlaylistService } from '../modules/live-sources/live-playlist.service'
import { LiveSourceRepository } from '../modules/live-sources/live-source.repository'
import { LiveSourceService } from '../modules/live-sources/live-source.service'
import { detectMediaStreamType } from '../modules/media/media-stream-detector.service'
import { MediaProxyServer } from '../modules/media/media-proxy-server'
import { probeMediaSource } from '../modules/media/media-probe.service'
import { SearchTaskManager } from '../modules/media/search-task-manager'
import { VodSearchService } from '../modules/media/vod-search.service'
import { decodeBase58String } from '../modules/sources/base58'
import { SourceService } from '../modules/sources/source.service'
import { VodSourceRepository } from '../modules/sources/vod-source.repository'
import { SettingsRepository } from '../modules/settings/settings.repository'
import { SettingsService } from '../modules/settings/settings.service'
import { UpdateService } from '../modules/updates/update.service'

// main 进程唯一的组合根：在此处集中装配依赖，领域模块不得自行创建全局实例。
export interface ApplicationContext {
  db: ReturnType<typeof createDatabase>
  getMainWindow: () => BrowserWindow | null
  setMainWindow: (window: BrowserWindow | null) => void
  repositories: {
    source: VodSourceRepository
    liveSource: LiveSourceRepository
    recentPlay: RecentPlayRepository
    favorite: FavoriteRepository
  }
  services: {
    source: SourceService
    liveSource: LiveSourceService
    livePlaylist: LivePlaylistService
    home: HomeService
    douban: DoubanService
    settings: SettingsService
    mediaProxy: MediaProxyServer
    vodSearch: VodSearchService
    updates: UpdateService
  }
  utilities: {
    httpClient: HttpClient
    decodeBase58String: typeof decodeBase58String
    probeMediaSource: typeof probeMediaSource
    detectMediaStreamType: typeof detectMediaStreamType
  }
}

export function createApplicationContext(): ApplicationContext {
  const db = createDatabase()
  const source = new VodSourceRepository(db)
  const liveSource = new LiveSourceRepository(db)
  const recentPlay = new RecentPlayRepository(db)
  const favorite = new FavoriteRepository(db)
  const settings = new SettingsService(new SettingsRepository(db))
  const httpClient = new HttpClient()
  // IPC 事件只投递给当前主窗口，避免业务服务直接持有 BrowserWindow。
  let mainWindow: BrowserWindow | null = null
  const getMainWindow = (): BrowserWindow | null => mainWindow
  const emitSearchEvent = (event: SearchEvent): void =>
    mainWindow?.webContents.send(IPC_CHANNELS.vod.searchEvent, event)
  const emitUpdateEvent: ConstructorParameters<typeof UpdateService>[1] = (event) =>
    mainWindow?.webContents.send(IPC_CHANNELS.updates.event, event)
  const sourceService = new SourceService(source)
  const douban = new DoubanService(httpClient)

  return {
    db,
    getMainWindow,
    setMainWindow: (window) => {
      mainWindow = window
    },
    repositories: { source, liveSource, recentPlay, favorite },
    services: {
      source: sourceService,
      liveSource: new LiveSourceService(liveSource),
      livePlaylist: new LivePlaylistService(httpClient),
      home: new HomeService(recentPlay, douban),
      douban,
      settings,
      mediaProxy: new MediaProxyServer(),
      vodSearch: new VodSearchService(sourceService, httpClient, new SearchTaskManager(), emitSearchEvent),
      updates: new UpdateService(settings, emitUpdateEvent),
    },
    utilities: { httpClient, decodeBase58String, probeMediaSource, detectMediaStreamType },
  }
}
