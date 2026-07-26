import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import { openExternalUrl } from '../infrastructure/external/external-link'

export function registerShellIpc(): void {
  ipcMain.handle(IPC_CHANNELS.shell.openExternal, (_event, url: string) => openExternalUrl(url))
}
