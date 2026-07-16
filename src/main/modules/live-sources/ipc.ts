import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { DEFAULT_LIVE_SOURCES_EXPORT_NAME } from '@shared/constants'
import { IPC_CHANNELS } from '@shared/ipc'
import type { AppApi } from '@shared/types'
import type { ApplicationContext } from '../../app/composition-root'

export function registerLiveSourcesIpc(context: ApplicationContext): void {
  const { liveSource, livePlaylist } = context.services
  ipcMain.handle(IPC_CHANNELS.liveSources.list, () => liveSource.list())
  ipcMain.handle(IPC_CHANNELS.liveSources.create, (_event, input: Parameters<AppApi['liveSources']['create']>[0]) =>
    liveSource.create(input),
  )
  ipcMain.handle(
    IPC_CHANNELS.liveSources.update,
    (_event, id: string, input: Parameters<AppApi['liveSources']['update']>[1]) => liveSource.update(id, input),
  )
  ipcMain.handle(IPC_CHANNELS.liveSources.reorder, (_event, ids: Parameters<AppApi['liveSources']['reorder']>[0]) =>
    liveSource.reorder(ids),
  )
  ipcMain.handle(IPC_CHANNELS.liveSources.delete, (_event, id: string) => liveSource.delete(id))
  ipcMain.handle(IPC_CHANNELS.liveSources.clear, () => liveSource.clear())
  ipcMain.handle(IPC_CHANNELS.liveSources.previewImport, (_event, payload: unknown) =>
    liveSource.previewImport(payload),
  )
  ipcMain.handle(IPC_CHANNELS.liveSources.confirmImport, (_event, payload: unknown) =>
    liveSource.confirmImport(payload),
  )
  ipcMain.handle(IPC_CHANNELS.liveSources.importFromFile, async () => {
    const window = requireWindow(context)
    const result = await dialog.showOpenDialog(window, {
      title: '导入直播源 JSON',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePaths[0])
      return { cancelled: true, created: [], overwritten: [], skipped: [], invalid: [] }
    const filePath = result.filePaths[0]
    return { ...liveSource.confirmImport(JSON.parse(await readFile(filePath, 'utf8'))), filePath, cancelled: false }
  })
  ipcMain.handle(IPC_CHANNELS.liveSources.exportToFile, async () => {
    const window = requireWindow(context)
    const items = liveSource.exportItems()
    const result = await dialog.showSaveDialog(window, {
      title: '导出直播源 JSON',
      defaultPath: DEFAULT_LIVE_SOURCES_EXPORT_NAME,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return { cancelled: true, count: 0 }
    await writeFile(result.filePath, `${JSON.stringify(items, null, 2)}\n`, 'utf8')
    return { cancelled: false, filePath: result.filePath, count: items.length }
  })
  ipcMain.handle(IPC_CHANNELS.live.loadPlaylist, (_event, url: Parameters<AppApi['live']['loadPlaylist']>[0]) =>
    livePlaylist.load(url),
  )
}

function requireWindow(context: ApplicationContext): BrowserWindow {
  const window = context.getMainWindow()
  if (!window) throw new Error('Main window is not available')
  return window
}
