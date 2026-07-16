import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import type { ApplicationContext } from '../../app/composition-root'

export function registerUpdatesIpc(context: ApplicationContext): void {
  const { updates } = context.services
  ipcMain.handle(IPC_CHANNELS.updates.getCurrentVersion, () => updates.getCurrentVersion())
  ipcMain.handle(IPC_CHANNELS.updates.check, () => updates.check())
  ipcMain.handle(IPC_CHANNELS.updates.download, () => updates.download())
  ipcMain.handle(IPC_CHANNELS.updates.install, () => updates.install())
}
