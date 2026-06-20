import { BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import type { AppApi, SearchEvent } from '@shared/types'
import { DEFAULT_SOURCES_EXPORT_NAME } from '@shared/constants/app-brand'
import packageJson from '../../../package.json'
import { createDatabase } from '../db/client'
import { FavoriteRepository } from '../repositories/favorite.repository'
import { RecentPlayRepository } from '../repositories/recent-play.repository'
import { SettingsRepository } from '../repositories/settings.repository'
import { VodSourceRepository } from '../repositories/vod-source.repository'
import { DoubanService } from '../services/douban.service'
import { openExternalUrl } from '../services/external-link'
import { HomeService } from '../services/home.service'
import { HttpClient } from '../services/http-client'
import { SearchTaskManager } from '../services/search-task-manager'
import { SettingsService } from '../services/settings.service'
import { SourceService } from '../services/source.service'
import { VodSearchService } from '../services/vod-search.service'
import { checkLatestRelease } from '../services/update-checker'

let mainWindow: BrowserWindow | null = null

export function setMainWindow(window: BrowserWindow): void {
  mainWindow = window
}

export function registerIpcHandlers(): void {
  const db = createDatabase()
  const sourceRepository = new VodSourceRepository(db)
  const recentPlayRepository = new RecentPlayRepository(db)
  const favoriteRepository = new FavoriteRepository(db)
  const settingsRepository = new SettingsRepository(db)

  const httpClient = new HttpClient()
  const sourceService = new SourceService(sourceRepository)
  const doubanService = new DoubanService(httpClient)
  const homeService = new HomeService(recentPlayRepository, doubanService)
  const settingsService = new SettingsService(settingsRepository)
  const searchTaskManager = new SearchTaskManager()
  const emitSearchEvent = (event: SearchEvent): void => {
    mainWindow?.webContents.send('vod:search-event', event)
  }
  const vodSearchService = new VodSearchService(sourceService, httpClient, searchTaskManager, emitSearchEvent)

  ipcMain.handle('sources:list', () => sourceService.list())
  ipcMain.handle('sources:create', (_event, input: Parameters<AppApi['sources']['create']>[0]) =>
    sourceService.create(input),
  )
  ipcMain.handle('sources:update', (_event, id: string, input: Parameters<AppApi['sources']['update']>[1]) =>
    sourceService.update(id, input),
  )
  ipcMain.handle('sources:delete', (_event, id: string) => sourceService.delete(id))
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
      title: '导入播放源 JSON',
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
      title: '导出播放源 JSON',
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
  ipcMain.handle('settings:get', () => settingsService.get())
  ipcMain.handle('settings:update', (_event, input: Parameters<AppApi['settings']['update']>[0]) =>
    settingsService.update(input),
  )
  ipcMain.handle('updates:get-current-version', () => packageJson.version)
  ipcMain.handle('updates:check', () => checkLatestRelease(packageJson.version))
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
  ipcMain.handle('shell:open-external', (_event, url: string) => openExternalUrl(url))
}
