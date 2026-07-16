import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import type { ApplicationContext } from '../app/composition-root'

export function registerWindowIpc(context: ApplicationContext): void {
  ipcMain.handle(IPC_CHANNELS.window.isMaximized, () => context.getMainWindow()?.isMaximized() ?? false)
  ipcMain.handle(IPC_CHANNELS.window.toggleMaximize, () => {
    const window = context.getMainWindow()
    if (!window) return false
    if (window.isMaximized()) {
      window.unmaximize()
      return false
    }
    window.maximize()
    return true
  })
}
