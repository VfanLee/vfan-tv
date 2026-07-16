import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import { openExternalUrl } from '../infrastructure/external/external-link'
import type { ApplicationContext } from '../app/composition-root'

export function registerShellIpc(context: ApplicationContext): void {
  ipcMain.handle(IPC_CHANNELS.shell.openExternal, (_event, url: string) =>
    openExternalUrl(url, context.services.settings.get()),
  )
}
