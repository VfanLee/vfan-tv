import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import type { AppApi } from '@shared/types'
import type { ApplicationContext } from '../../app/composition-root'

export function registerMediaIpc(context: ApplicationContext): void {
  const { vodSearch, mediaProxy } = context.services
  const { probeMediaSource, detectMediaStreamType } = context.utilities
  ipcMain.handle(IPC_CHANNELS.vod.search, (_event, keyword: string) => vodSearch.search(keyword))
  ipcMain.handle(IPC_CHANNELS.vod.cancelSearch, (_event, searchId: string) => vodSearch.cancel(searchId))
  ipcMain.handle(IPC_CHANNELS.vod.probeMedia, (_event, input: Parameters<AppApi['vod']['probeMedia']>[0]) =>
    probeMediaSource(input),
  )
  ipcMain.handle(IPC_CHANNELS.media.getProxyBaseUrl, () => mediaProxy.getBaseUrl())
  ipcMain.handle(
    IPC_CHANNELS.media.detectStreamType,
    (_event, input: Parameters<AppApi['media']['detectStreamType']>[0]) => detectMediaStreamType(input),
  )
}
