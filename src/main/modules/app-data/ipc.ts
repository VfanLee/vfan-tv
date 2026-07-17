import { randomUUID } from 'crypto'
import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { DEFAULT_APP_DATA_EXPORT_NAME } from '@shared/constants'
import { IPC_CHANNELS } from '@shared/ipc'
import { appDataBackupSchema, appDataClientPayloadSchema } from '@shared/schemas'
import type { AppApi, AppDataBackup, AppDataOperationCounts } from '@shared/types'
import { resetAppDatabase } from '../../infrastructure/database/client'
import type { ApplicationContext } from '../../app/composition-root'
import { formatZodError, isZodError } from '../../ipc/utils'

// 应用备份跨越多个领域；这里负责将数据库数据与 renderer 持有的搜索历史合并为单一文件。
export function registerAppDataIpc(context: ApplicationContext): void {
  ipcMain.handle(
    IPC_CHANNELS.settings.exportAppData,
    async (_event, clientData: Parameters<AppApi['settings']['exportAppData']>[0]) => {
      const window = requireWindow(context)
      const payload = appDataClientPayloadSchema.parse(clientData)
      const { source, liveSource, settings } = context.services
      const { recentPlay, favorite } = context.repositories
      const appSettings = settings.get()
      const backup: AppDataBackup = {
        app: 'vfan-tv',
        schemaVersion: 1,
        exportedAt: Date.now(),
        subscription: { url: appSettings.subscriptionUrl, updatedAt: appSettings.subscriptionUpdatedAt },
        vod: source
          .list()
          .map(({ name, url, referer, enabled, origin, sort }) => ({ name, url, referer, enabled, origin, sort })),
        live: liveSource.list().map(({ name, url, enabled, origin, sort }) => ({ name, url, enabled, origin, sort })),
        recent: recentPlay.list(Number.MAX_SAFE_INTEGER),
        favorites: favorite.list(),
        searchHistory: payload.searchHistory,
      }
      const result = await dialog.showSaveDialog(window, {
        title: '导出应用数据 JSON',
        defaultPath: DEFAULT_APP_DATA_EXPORT_NAME,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (result.canceled || !result.filePath) return { cancelled: true, counts: emptyAppDataCounts() }
      await writeFile(result.filePath, `${JSON.stringify(backup, null, 2)}\n`, 'utf8')
      return { cancelled: false, filePath: result.filePath, counts: getAppDataCounts(backup) }
    },
  )
  ipcMain.handle(IPC_CHANNELS.settings.importAppData, async () => {
    const window = requireWindow(context)
    const result = await dialog.showOpenDialog(window, {
      title: '导入应用数据 JSON',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePaths[0])
      return { cancelled: true, counts: emptyAppDataCounts(), searchHistory: [] }
    const filePath = result.filePaths[0]
    const backup = parseAppDataBackup(await readFile(filePath, 'utf8'))
    const now = Date.now()
    const { settings } = context.services
    const { source: sourceRepository, liveSource: liveSourceRepository, recentPlay, favorite } = context.repositories
    // 先清空再按备份顺序恢复，确保导入结果不会与旧数据混合。
    resetAppDatabase(context.db)
    settings.update({ subscriptionUrl: backup.subscription.url, subscriptionUpdatedAt: backup.subscription.updatedAt })
    for (const [sort, item] of backup.vod.entries())
      sourceRepository.upsert({ id: randomUUID(), ...item, sort, createdAt: now, updatedAt: now })
    for (const [sort, item] of backup.live.entries())
      liveSourceRepository.upsert({ id: randomUUID(), ...item, sort, createdAt: now, updatedAt: now })
    for (const item of backup.recent) recentPlay.upsert(item)
    for (const item of backup.favorites) favorite.importItem(item)
    return { cancelled: false, filePath, counts: getAppDataCounts(backup), searchHistory: backup.searchHistory }
  })
}

function requireWindow(context: ApplicationContext): BrowserWindow {
  const window = context.getMainWindow()
  if (!window) throw new Error('Main window is not available')
  return window
}

function parseAppDataBackup(fileContent: string): AppDataBackup {
  try {
    // 运行时 schema 是外部备份文件的信任边界，不能只依赖 TypeScript 类型。
    return appDataBackupSchema.parse(JSON.parse(fileContent))
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('导入文件不是有效的 JSON')
    if (isZodError(error)) throw new Error(`应用数据格式无效：${formatZodError(error)}`)
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
  return { vod: 0, live: 0, recent: 0, favorites: 0, searchHistory: 0 }
}
