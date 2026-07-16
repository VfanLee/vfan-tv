import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import type { AppApi } from '@shared/types'
import type { ApplicationContext } from '../../app/composition-root'

export function registerLibraryIpc(context: ApplicationContext): void {
  const { recentPlay, favorite } = context.repositories
  ipcMain.handle(IPC_CHANNELS.recent.list, (_event, limit?: number) => recentPlay.list(limit))
  ipcMain.handle(IPC_CHANNELS.recent.upsert, (_event, input: Parameters<AppApi['recent']['upsert']>[0]) =>
    recentPlay.upsert(input),
  )
  ipcMain.handle(IPC_CHANNELS.recent.remove, (_event, title: string) => recentPlay.deleteByTitle(title))
  ipcMain.handle(IPC_CHANNELS.favorites.list, () => favorite.list())
  ipcMain.handle(IPC_CHANNELS.favorites.isFavorite, (_event, sourceId: string, vodId: string) =>
    favorite.isFavorite(sourceId, vodId),
  )
  ipcMain.handle(IPC_CHANNELS.favorites.add, (_event, input: Parameters<AppApi['favorites']['add']>[0]) =>
    favorite.upsert(input),
  )
  ipcMain.handle(IPC_CHANNELS.favorites.remove, (_event, sourceId: string, vodId: string) =>
    favorite.delete(sourceId, vodId),
  )
}
