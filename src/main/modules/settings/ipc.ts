import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import type { AppApi } from '@shared/types'
import type { ApplicationContext } from '../../app/composition-root'
import { resetAppDatabase } from '../../infrastructure/database/client'

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
  ipcMain.handle(IPC_CHANNELS.settings.initializeAppData, async () => {
    resetAppDatabase(context.db)
    const window = context.getMainWindow()
    // 数据库重置后同步清除 Chromium 存储，防止旧缓存与新数据状态不一致。
    await window?.webContents.session.clearStorageData()
    await window?.webContents.session.clearCache()
    return settings.get()
  })
}
