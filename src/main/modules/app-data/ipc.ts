import { randomUUID } from 'crypto'
import { BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { DEFAULT_APP_DATA_EXPORT_NAME } from '@shared/constants'
import { IPC_CHANNELS } from '@shared/ipc'
import { appDataBackupSchema, appDataClientPayloadSchema } from '@shared/schemas'
import type { AppApi, AppDataBackup, AppDataOperationCounts } from '@shared/types'
import { resetAppDatabase } from '../../infrastructure/database/client'
import type { ApplicationContext } from '../../app/composition-root'
import { broadcastAppDataChange } from '../../ipc/broadcast'
import { formatZodError, isZodError } from '../../ipc/utils'

/** 注册应用数据导入、导出与清理处理器，并把数据库数据和 renderer 数据合并为统一备份 */
export function registerAppDataIpc(context: ApplicationContext): void {
  ipcMain.handle(
    IPC_CHANNELS.settings.exportAppData,
    async (event, clientData: Parameters<AppApi['settings']['exportAppData']>[0]) => {
      const window = requireWindow(event.sender)
      const payload = appDataClientPayloadSchema.parse(clientData)
      const { selection } = payload
      const { source, iptvSource, settings } = context.services
      const { recentPlay, favorite } = context.repositories
      const appSettings = settings.get()
      const backup: AppDataBackup = {
        app: 'vfan-tv',
        schemaVersion: 4,
        exportedAt: Date.now(),
        subscriptions: selection.sources ? appSettings.subscriptions : [],
        activeSubscriptionId: selection.sources ? appSettings.activeSubscriptionId : undefined,
        vod: (selection.sources ? source.list() : []).map(
          ({ name, url, headers, disabled, backups, origin, sort }) => ({
            name,
            url,
            headers,
            disabled,
            backups,
            origin,
            sort,
          }),
        ),
        iptv: (selection.sources ? iptvSource.list() : []).map(({ name, url, disabled, origin, sort, headers }) => ({
          name,
          url,
          disabled,
          origin,
          sort,
          headers,
        })),
        recent: selection.recent ? recentPlay.list(Number.MAX_SAFE_INTEGER) : [],
        favorites: selection.favorites ? favorite.list() : [],
        searchHistory: selection.searchHistory ? payload.searchHistory : [],
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
  ipcMain.handle(IPC_CHANNELS.settings.importAppData, async (event) => {
    const window = requireWindow(event.sender)
    const result = await dialog.showOpenDialog(window, {
      title: '导入应用数据 JSON',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePaths[0])
      return { cancelled: true, counts: emptyAppDataCounts(), searchHistory: [] }
    const filePath = result.filePaths[0]
    const backup = parseAppDataBackup(await readFile(filePath, 'utf8'))
    assertUniqueVodEndpointUrls(backup)
    const now = Date.now()
    const { settings } = context.services
    const currentNetworkSettings = settings.get().network
    const { source: sourceRepository, iptvSource: iptvSourceRepository, recentPlay, favorite } = context.repositories
    // 清空已选数据后按备份顺序恢复。
    resetAppDatabase(context.db)
    const subscriptions = backup.subscriptions
    settings.update({
      subscriptions,
      network: currentNetworkSettings,
      activeSubscriptionId: subscriptions.some((item) => item.id === backup.activeSubscriptionId)
        ? backup.activeSubscriptionId
        : subscriptions[0]?.id,
    })
    for (const [sort, item] of backup.vod.entries())
      sourceRepository.upsert({
        id: randomUUID(),
        ...item,
        sort,
        createdAt: now,
        updatedAt: now,
      })
    for (const [sort, item] of backup.iptv.entries())
      iptvSourceRepository.upsert({
        id: randomUUID(),
        ...item,
        sort,
        createdAt: now,
        updatedAt: now,
      })
    for (const item of backup.recent) recentPlay.upsert(item)
    for (const item of backup.favorites) favorite.importItem(item)
    broadcastAppDataChange('app-data')
    return { cancelled: false, filePath, counts: getAppDataCounts(backup), searchHistory: backup.searchHistory }
  })
}

function requireWindow(sender: WebContents): BrowserWindow {
  const window = BrowserWindow.fromWebContents(sender)
  if (!window) throw new Error('The requesting window is not available')
  return window
}

function parseAppDataBackup(fileContent: string): AppDataBackup {
  try {
    // 使用运行时 Schema 校验外部备份文件。
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
    iptv: backup.iptv.length,
    recent: backup.recent.length,
    favorites: backup.favorites.length,
    searchHistory: backup.searchHistory.length,
  }
}

function emptyAppDataCounts(): AppDataOperationCounts {
  return { vod: 0, iptv: 0, recent: 0, favorites: 0, searchHistory: 0 }
}

function assertUniqueVodEndpointUrls(backup: AppDataBackup): void {
  const owners = new Map<string, string>()
  for (const source of backup.vod) {
    for (const url of [source.url, ...source.backups]) {
      const owner = owners.get(url)
      if (owner) throw new Error(`VOD 地址同时存在于「${owner}」和「${source.name}」`)
      owners.set(url, source.name)
    }
  }
}
