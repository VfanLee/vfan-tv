import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import bs58 from 'bs58'
import { DEFAULT_SOURCES_EXPORT_NAME } from '@shared/constants'
import { IPC_CHANNELS } from '@shared/ipc'
import { sourceSubscriptionSchema } from '@shared/schemas'
import type { AppApi } from '@shared/types'
import type { ApplicationContext } from '../../app/composition-root'
import { formatZodError, isZodError } from '../../ipc/utils'

// 点播源 IPC：文件导入导出留在 main，以避免 renderer 获得任意文件系统权限。
export function registerSourcesIpc(context: ApplicationContext): void {
  const { source, liveSource } = context.services
  const { httpClient } = context.utilities
  ipcMain.handle(IPC_CHANNELS.sources.list, () => source.list())
  ipcMain.handle(IPC_CHANNELS.sources.create, (_event, input: Parameters<AppApi['sources']['create']>[0]) =>
    source.create(input),
  )
  ipcMain.handle(IPC_CHANNELS.sources.update, (_event, id: string, input: Parameters<AppApi['sources']['update']>[1]) =>
    source.update(id, input),
  )
  ipcMain.handle(IPC_CHANNELS.sources.reorder, (_event, ids: Parameters<AppApi['sources']['reorder']>[0]) =>
    source.reorder(ids),
  )
  ipcMain.handle(IPC_CHANNELS.sources.delete, (_event, id: string) => source.delete(id))
  ipcMain.handle(IPC_CHANNELS.sources.clear, () => source.clear())
  ipcMain.handle(IPC_CHANNELS.sources.previewImport, (_event, payload: unknown) => source.previewImport(payload))
  ipcMain.handle(IPC_CHANNELS.sources.confirmImport, (_event, payload: unknown) => source.confirmImport(payload))
  ipcMain.handle(IPC_CHANNELS.sources.importFromFile, async () => {
    const window = requireWindow(context)
    const result = await dialog.showOpenDialog(window, {
      title: '导入数据源 JSON',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePaths[0])
      return { cancelled: true, created: [], overwritten: [], skipped: [], invalid: [] }
    const filePath = result.filePaths[0]
    return { ...source.confirmImport(JSON.parse(await readFile(filePath, 'utf8'))), filePath, cancelled: false }
  })
  ipcMain.handle(IPC_CHANNELS.sources.exportToFile, async () => {
    const window = requireWindow(context)
    const items = source.exportItems()
    const result = await dialog.showSaveDialog(window, {
      title: '导出数据源 JSON',
      defaultPath: DEFAULT_SOURCES_EXPORT_NAME,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return { cancelled: true, count: 0 }
    await writeFile(result.filePath, `${JSON.stringify(items, null, 2)}\n`, 'utf8')
    return { cancelled: false, filePath: result.filePath, count: items.length }
  })
  ipcMain.handle(
    IPC_CHANNELS.sources.syncSubscription,
    async (_event, url: Parameters<AppApi['sources']['syncSubscription']>[0]) => {
      const parsedUrl = new URL(url)
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('订阅地址仅支持 HTTP 或 HTTPS')
      const encoded = await httpClient.get<string>(parsedUrl.toString(), {
        responseType: 'text',
        maxContentLength: 2 * 1024 * 1024,
      })
      try {
        // 订阅内容在解码后仍需 schema 校验，远程输入不能直接写入本地数据库。
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bs58.decode(encoded.trim()))
        const subscription = sourceSubscriptionSchema.parse(JSON.parse(decoded))
        return {
          vod: source.syncSubscription(subscription.vod),
          live: liveSource.syncSubscription(subscription.live),
          updatedAt: subscription.updatedAt,
        }
      } catch (error) {
        if (error instanceof SyntaxError) throw new Error('订阅内容解码后不是有效的 JSON')
        if (isZodError(error)) throw new Error(`订阅配置格式无效：${formatZodError(error)}`)
        throw error
      }
    },
  )
}

function requireWindow(context: ApplicationContext): BrowserWindow {
  const window = context.getMainWindow()
  if (!window) throw new Error('Main window is not available')
  return window
}
