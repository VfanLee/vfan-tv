import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import { appDataClearSelectionSchema } from '@shared/schemas'
import type { AppApi } from '@shared/types'
import type { ApplicationContext } from '../../app/composition-root'
import { broadcastAppDataChange } from '../../ipc/broadcast'
import { removeDeprecatedDatabaseFiles, resetAppDatabase } from '../../infrastructure/database/client'

/** 注册设置读写、恢复出厂和数据清理 IPC 处理器 */
export function registerSettingsIpc(context: ApplicationContext): void {
  const { settings } = context.services
  ipcMain.handle(IPC_CHANNELS.settings.get, () => settings.get())
  ipcMain.handle(IPC_CHANNELS.settings.update, (_event, input: Parameters<AppApi['settings']['update']>[0]) => {
    const updated = settings.update(input)
    broadcastAppDataChange('settings')
    return updated
  })
  ipcMain.handle(IPC_CHANNELS.settings.restoreFactorySettings, async () => {
    resetAppDatabase(context.db)
    removeDeprecatedDatabaseFiles()
    await context.services.network.applySettings(settings.get().network)
    const currentSession = context.getMainWindow()?.webContents.session
    if (currentSession) {
      await currentSession.clearCache()
      await currentSession.clearStorageData()
    }
    await context.services.network.clearCache()
    context.services.mediaProxy.clearSessions()
    context.services.mediaPlaybackTarget.clearDetectionCache()
    broadcastAppDataChange('app-data')
  })
  ipcMain.handle(
    IPC_CHANNELS.settings.clearAppData,
    async (_event, input: Parameters<AppApi['settings']['clearAppData']>[0]) => {
      const selection = appDataClearSelectionSchema.parse(input)
      const { source, iptvSource, settings } = context.services
      const { recentPlay, favorite, iptvCache } = context.repositories
      if (selection.sources) {
        settings.update({
          activeSubscriptionId: undefined,
          subscriptions: [],
        })
        source.clear()
        iptvSource.clear()
        context.services.mediaProxy.clearSessions()
        context.services.mediaPlaybackTarget.clearDetectionCache()
      }
      if (selection.recent) recentPlay.clear()
      if (selection.favorites) favorite.clear()
      if (selection.cache) {
        await context.getMainWindow()?.webContents.session.clearCache()
        await context.services.network.clearCache()
        iptvCache.clearAll()
        context.services.mediaProxy.clearSessions()
        context.services.mediaPlaybackTarget.clearDetectionCache()
      }
      broadcastAppDataChange('app-data')
    },
  )
}
