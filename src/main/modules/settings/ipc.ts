import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import type { AppApi } from '@shared/types'
import type { ApplicationContext } from '../../app/composition-root'
import { resetAppDatabase } from '../../infrastructure/database/client'

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
  ipcMain.handle(IPC_CHANNELS.settings.initializeAppData, async () => {
    resetAppDatabase(context.db)
    const window = context.getMainWindow()
    await window?.webContents.session.clearStorageData()
    await window?.webContents.session.clearCache()
    return settings.get()
  })
}
