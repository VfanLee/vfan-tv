import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { readFile, writeFile } from 'fs/promises'
import { appDataBackupSchema, appDataClientPayloadSchema, sourceSubscriptionSchema } from '@shared/schemas'
import type { AppApi, AppDataBackup, AppDataOperationCounts, SearchEvent } from '@shared/types'
import {
  DEFAULT_APP_DATA_EXPORT_NAME,
  DEFAULT_LIVE_SOURCES_EXPORT_NAME,
  DEFAULT_SOURCES_EXPORT_NAME,
} from '@shared/constants'
import packageJson from '../../../package.json'
import { createDatabase, resetAppDatabase } from '../db/client'
import { FavoriteRepository } from '../repositories/favorite.repository'
import { LiveSourceRepository } from '../repositories/live-source.repository'
import { RecentPlayRepository } from '../repositories/recent-play.repository'
import { SettingsRepository } from '../repositories/settings.repository'
import { VodSourceRepository } from '../repositories/vod-source.repository'
import { DoubanService } from '../services/douban.service'
import { openExternalUrl } from '../services/external-link'
import { HomeService } from '../services/home.service'
import { HttpClient } from '../services/http-client'
import { LiveSourceService } from '../services/live-source.service'
import { MediaProxyServer } from '../services/media-proxy-server'
import { LivePlaylistService } from '../services/live-playlist.service'
import { probeMediaSource } from '../services/media-probe.service'
import { SearchTaskManager } from '../services/search-task-manager'
import { SettingsService } from '../services/settings.service'
import { SourceService } from '../services/source.service'
import { decodeBase58String } from '../services/base58'
import { VodSearchService } from '../services/vod-search.service'
import { UpdateService } from '../services/update.service'

let mainWindow: BrowserWindow | null = null

export function setMainWindow(window: BrowserWindow): void {
  mainWindow = window
}

export function registerIpcHandlers(): void {
  const db = createDatabase()
  const sourceRepository = new VodSourceRepository(db)
  const liveSourceRepository = new LiveSourceRepository(db)
  const recentPlayRepository = new RecentPlayRepository(db)
  const favoriteRepository = new FavoriteRepository(db)
  const settingsRepository = new SettingsRepository(db)

  const httpClient = new HttpClient()
  const sourceService = new SourceService(sourceRepository)
  const liveSourceService = new LiveSourceService(liveSourceRepository)
  const doubanService = new DoubanService(httpClient)
  const homeService = new HomeService(recentPlayRepository, doubanService)
  const mediaProxyServer = new MediaProxyServer()
  const livePlaylistService = new LivePlaylistService(httpClient)
  const settingsService = new SettingsService(settingsRepository)
  const searchTaskManager = new SearchTaskManager()
  const emitSearchEvent = (event: SearchEvent): void => {
    mainWindow?.webContents.send('vod:search-event', event)
  }
  const emitUpdateEvent: ConstructorParameters<typeof UpdateService>[1] = (event) => {
    mainWindow?.webContents.send('updates:event', event)
  }
  const vodSearchService = new VodSearchService(sourceService, httpClient, searchTaskManager, emitSearchEvent)
  const updateService = new UpdateService(settingsService, emitUpdateEvent)

  ipcMain.handle('sources:list', () => sourceService.list())
  ipcMain.handle('sources:create', (_event, input: Parameters<AppApi['sources']['create']>[0]) =>
    sourceService.create(input),
  )
  ipcMain.handle('sources:update', (_event, id: string, input: Parameters<AppApi['sources']['update']>[1]) =>
    sourceService.update(id, input),
  )
  ipcMain.handle('sources:reorder', (_event, sourceIds: Parameters<AppApi['sources']['reorder']>[0]) =>
    sourceService.reorder(sourceIds),
  )
  ipcMain.handle('sources:delete', (_event, id: string) => sourceService.delete(id))
  ipcMain.handle('sources:clear', () => sourceService.clear())
  ipcMain.handle('sources:preview-import', (_event, payload: Parameters<AppApi['sources']['previewImport']>[0]) =>
    sourceService.previewImport(payload),
  )
  ipcMain.handle('sources:confirm-import', (_event, payload: Parameters<AppApi['sources']['confirmImport']>[0]) =>
    sourceService.confirmImport(payload),
  )
  ipcMain.handle('sources:import-from-file', async () => {
    if (!mainWindow) {
      throw new Error('Main window is not available')
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入数据源 JSON',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })

    if (result.canceled || !result.filePaths[0]) {
      return { cancelled: true, created: [], overwritten: [], skipped: [], invalid: [] }
    }

    const filePath = result.filePaths[0]
    const fileContent = await readFile(filePath, 'utf8')
    const importResult = sourceService.confirmImport(JSON.parse(fileContent))

    return {
      ...importResult,
      filePath,
      cancelled: false,
    }
  })
  ipcMain.handle('sources:export-to-file', async () => {
    if (!mainWindow) {
      throw new Error('Main window is not available')
    }

    const items = sourceService.exportItems()
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出数据源 JSON',
      defaultPath: DEFAULT_SOURCES_EXPORT_NAME,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })

    if (result.canceled || !result.filePath) {
      return { cancelled: true, count: 0 }
    }

    await writeFile(result.filePath, `${JSON.stringify(items, null, 2)}\n`, 'utf8')

    return {
      cancelled: false,
      filePath: result.filePath,
      count: items.length,
    }
  })
  ipcMain.handle(
    'sources:sync-subscription',
    async (_event, url: Parameters<AppApi['sources']['syncSubscription']>[0]) => {
      const parsedUrl = new URL(url)

      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('订阅地址仅支持 HTTP 或 HTTPS')
      }

      const encoded = await httpClient.get<string>(parsedUrl.toString(), {
        responseType: 'text',
        maxContentLength: 2 * 1024 * 1024,
      })
      const decoded = decodeBase58String(encoded)

      try {
        const subscription = sourceSubscriptionSchema.parse(JSON.parse(decoded))

        return {
          vod: sourceService.syncSubscription(subscription.vod),
          live: liveSourceService.syncSubscription(subscription.live),
          updatedAt: subscription.updatedAt,
        }
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error('订阅内容解码后不是有效的 JSON')
        }
        if (isZodError(error)) {
          throw new Error(`订阅配置格式无效：${formatZodError(error)}`)
        }
        throw error
      }
    },
  )

  ipcMain.handle('live-sources:list', () => liveSourceService.list())
  ipcMain.handle('live-sources:create', (_event, input: Parameters<AppApi['liveSources']['create']>[0]) =>
    liveSourceService.create(input),
  )
  ipcMain.handle('live-sources:update', (_event, id: string, input: Parameters<AppApi['liveSources']['update']>[1]) =>
    liveSourceService.update(id, input),
  )
  ipcMain.handle('live-sources:reorder', (_event, sourceIds: Parameters<AppApi['liveSources']['reorder']>[0]) =>
    liveSourceService.reorder(sourceIds),
  )
  ipcMain.handle('live-sources:delete', (_event, id: string) => liveSourceService.delete(id))
  ipcMain.handle('live-sources:clear', () => liveSourceService.clear())
  ipcMain.handle(
    'live-sources:preview-import',
    (_event, payload: Parameters<AppApi['liveSources']['previewImport']>[0]) =>
      liveSourceService.previewImport(payload),
  )
  ipcMain.handle(
    'live-sources:confirm-import',
    (_event, payload: Parameters<AppApi['liveSources']['confirmImport']>[0]) =>
      liveSourceService.confirmImport(payload),
  )
  ipcMain.handle('live-sources:import-from-file', async () => {
    if (!mainWindow) {
      throw new Error('Main window is not available')
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入直播源 JSON',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })

    if (result.canceled || !result.filePaths[0]) {
      return { cancelled: true, created: [], overwritten: [], skipped: [], invalid: [] }
    }

    const filePath = result.filePaths[0]
    const fileContent = await readFile(filePath, 'utf8')
    const importResult = liveSourceService.confirmImport(JSON.parse(fileContent))

    return {
      ...importResult,
      filePath,
      cancelled: false,
    }
  })
  ipcMain.handle('live-sources:export-to-file', async () => {
    if (!mainWindow) {
      throw new Error('Main window is not available')
    }

    const items = liveSourceService.exportItems()
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出直播源 JSON',
      defaultPath: DEFAULT_LIVE_SOURCES_EXPORT_NAME,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })

    if (result.canceled || !result.filePath) {
      return { cancelled: true, count: 0 }
    }

    await writeFile(result.filePath, `${JSON.stringify(items, null, 2)}\n`, 'utf8')

    return {
      cancelled: false,
      filePath: result.filePath,
      count: items.length,
    }
  })

  ipcMain.handle('home:get', () => homeService.get())
  ipcMain.handle('home:get-hot', (_event, input: Parameters<AppApi['home']['getHot']>[0]) =>
    doubanService.getRecentHotPage(input),
  )
  ipcMain.handle('recent:list', (_event, limit?: number) => recentPlayRepository.list(limit))
  ipcMain.handle('recent:upsert', (_event, input: Parameters<AppApi['recent']['upsert']>[0]) =>
    recentPlayRepository.upsert(input),
  )
  ipcMain.handle('recent:remove', (_event, title: string) => recentPlayRepository.deleteByTitle(title))
  ipcMain.handle('favorites:list', () => favoriteRepository.list())
  ipcMain.handle('favorites:is-favorite', (_event, sourceId: string, vodId: string) =>
    favoriteRepository.isFavorite(sourceId, vodId),
  )
  ipcMain.handle('favorites:add', (_event, input: Parameters<AppApi['favorites']['add']>[0]) =>
    favoriteRepository.upsert(input),
  )
  ipcMain.handle('favorites:remove', (_event, sourceId: string, vodId: string) =>
    favoriteRepository.delete(sourceId, vodId),
  )
  ipcMain.handle('vod:search', (_event, keyword: string) => vodSearchService.search(keyword))
  ipcMain.handle('vod:cancel-search', (_event, searchId: string) => vodSearchService.cancel(searchId))
  ipcMain.handle('vod:probe-media', (_event, input: Parameters<AppApi['vod']['probeMedia']>[0]) =>
    probeMediaSource(input),
  )
  ipcMain.handle('live:load-playlist', (_event, url: Parameters<AppApi['live']['loadPlaylist']>[0]) =>
    livePlaylistService.load(url),
  )
  ipcMain.handle('media:get-proxy-base-url', () => mediaProxyServer.getBaseUrl())
  ipcMain.handle('settings:get', () => settingsService.get())
  ipcMain.handle('settings:update', (_event, input: Parameters<AppApi['settings']['update']>[0]) =>
    settingsService.update(input),
  )
  ipcMain.handle(
    'settings:test-github-proxy',
    (_event, routeId: Parameters<AppApi['settings']['testGitHubProxy']>[0], customPrefix?: string) =>
      settingsService.testGitHubProxy(routeId, customPrefix),
  )
  ipcMain.handle('settings:initialize-app-data', async () => {
    resetAppDatabase(db)
    await mainWindow?.webContents.session.clearStorageData()
    await mainWindow?.webContents.session.clearCache()
    return settingsService.get()
  })
  ipcMain.handle(
    'settings:export-app-data',
    async (_event, clientData: Parameters<AppApi['settings']['exportAppData']>[0]) => {
      if (!mainWindow) {
        throw new Error('Main window is not available')
      }

      const payload = appDataClientPayloadSchema.parse(clientData)
      const settings = settingsService.get()
      const backup: AppDataBackup = {
        app: 'vfan-tv',
        schemaVersion: 1,
        exportedAt: Date.now(),
        subscription: {
          url: settings.subscriptionUrl,
          updatedAt: settings.subscriptionUpdatedAt,
        },
        vod: sourceService.list().map((source) => ({
          name: source.name,
          url: source.url,
          referer: source.referer,
          enabled: source.enabled,
          origin: source.origin,
          sort: source.sort,
        })),
        live: liveSourceService.list().map((source) => ({
          name: source.name,
          url: source.url,
          enabled: source.enabled,
          origin: source.origin,
          sort: source.sort,
        })),
        recent: recentPlayRepository.list(Number.MAX_SAFE_INTEGER),
        favorites: favoriteRepository.list(),
        searchHistory: payload.searchHistory,
      }

      const result = await dialog.showSaveDialog(mainWindow, {
        title: '导出应用数据 JSON',
        defaultPath: DEFAULT_APP_DATA_EXPORT_NAME,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })

      if (result.canceled || !result.filePath) {
        return { cancelled: true, counts: emptyAppDataCounts() }
      }

      await writeFile(result.filePath, `${JSON.stringify(backup, null, 2)}\n`, 'utf8')

      return {
        cancelled: false,
        filePath: result.filePath,
        counts: getAppDataCounts(backup),
      }
    },
  )
  ipcMain.handle('settings:import-app-data', async () => {
    if (!mainWindow) {
      throw new Error('Main window is not available')
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入应用数据 JSON',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })

    if (result.canceled || !result.filePaths[0]) {
      return { cancelled: true, counts: emptyAppDataCounts(), searchHistory: [] }
    }

    const filePath = result.filePaths[0]
    const fileContent = await readFile(filePath, 'utf8')
    const backup = parseAppDataBackup(fileContent)
    const now = Date.now()

    resetAppDatabase(db)
    settingsService.update({
      subscriptionUrl: backup.subscription.url,
      subscriptionUpdatedAt: backup.subscription.updatedAt,
    })

    for (const [sort, source] of backup.vod.entries()) {
      sourceRepository.upsert({
        id: randomUUID(),
        name: source.name,
        url: source.url,
        referer: source.referer,
        enabled: source.enabled,
        sort,
        origin: source.origin,
        createdAt: now,
        updatedAt: now,
      })
    }

    for (const [sort, source] of backup.live.entries()) {
      liveSourceRepository.upsert({
        id: randomUUID(),
        name: source.name,
        url: source.url,
        enabled: source.enabled,
        sort,
        origin: source.origin,
        createdAt: now,
        updatedAt: now,
      })
    }

    for (const item of backup.recent) {
      recentPlayRepository.upsert(item)
    }

    for (const item of backup.favorites) {
      favoriteRepository.importItem(item)
    }

    return {
      cancelled: false,
      filePath,
      counts: getAppDataCounts(backup),
      searchHistory: backup.searchHistory,
    }
  })
  ipcMain.handle('updates:get-current-version', () => app.getVersion() || packageJson.version)
  ipcMain.handle('updates:check', () => updateService.check())
  ipcMain.handle('updates:download', () => updateService.download())
  ipcMain.handle('updates:install', () => updateService.install())
  ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false)
  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow) {
      return false
    }

    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
      return false
    }

    mainWindow.maximize()
    return true
  })
  ipcMain.handle('shell:open-external', (_event, url: string) => openExternalUrl(url, settingsService.get()))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseAppDataBackup(fileContent: string): AppDataBackup {
  try {
    return appDataBackupSchema.parse(JSON.parse(fileContent))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('导入文件不是有效的 JSON')
    }
    if (isZodError(error)) {
      throw new Error(`应用数据格式无效：${formatZodError(error)}`)
    }
    throw error
  }
}

function getAppDataCounts(backup: AppDataBackup): AppDataOperationCounts {
  return {
    vod: backup.vod.length,
    live: backup.live.length,
    recent: backup.recent.length,
    favorites: backup.favorites.length,
    searchHistory: backup.searchHistory.length,
  }
}

function emptyAppDataCounts(): AppDataOperationCounts {
  return {
    vod: 0,
    live: 0,
    recent: 0,
    favorites: 0,
    searchHistory: 0,
  }
}

function isZodError(error: unknown): error is { issues: Array<{ path: Array<string | number>; message: string }> } {
  return isRecord(error) && Array.isArray(error.issues)
}

function formatZodError(error: { issues: Array<{ path: Array<string | number>; message: string }> }): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '根节点'
      return `${path}: ${issue.message}`
    })
    .join('；')
}
