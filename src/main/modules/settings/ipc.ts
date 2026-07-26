import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import { appDataSelectionSchema } from '@shared/schemas'
import type { AppApi } from '@shared/types'
import type { ApplicationContext } from '../../app/composition-root'

// 设置 IPC 只协调原生会话清理；具体设置校验与持久化由 SettingsService 负责。
export function registerSettingsIpc(context: ApplicationContext): void {
  const { settings } = context.services
  ipcMain.handle(IPC_CHANNELS.settings.get, () => settings.get())
  ipcMain.handle(IPC_CHANNELS.settings.update, (_event, input: Parameters<AppApi['settings']['update']>[0]) =>
    settings.update(input),
  )
  ipcMain.handle(
    IPC_CHANNELS.settings.testGitHubProxy,
    (_event, routeId: Parameters<AppApi['settings']['testGitHubProxy']>[0], customPrefix?: string) =>
      settings.testGitHubProxy(routeId, customPrefix),
  )
  ipcMain.handle(
    IPC_CHANNELS.settings.initializeAppData,
    async (_event, input: Parameters<AppApi['settings']['initializeAppData']>[0]) => {
      const options = appDataSelectionSchema.parse(input)
      const { source, liveSource, settings } = context.services
      const { recentPlay, favorite } = context.repositories
      if (options.sources) {
        settings.update({ activeSubscriptionId: undefined, subscriptions: [] })
        source.clear()
        liveSource.clear()
      }
      if (options.recent) recentPlay.clear()
      if (options.favorites) favorite.clear()
    },
  )
  ipcMain.handle(IPC_CHANNELS.settings.clearAppCache, async () => {
    await context.getMainWindow()?.webContents.session.clearCache()
  })
}
