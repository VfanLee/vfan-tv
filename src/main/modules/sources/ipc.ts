import { BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import bs58 from 'bs58'
import { DEFAULT_SOURCES_EXPORT_NAME } from '@shared/constants'
import { IPC_CHANNELS } from '@shared/ipc'
import { sourceSubscriptionSchema } from '@shared/schemas'
import type { AppApi, SubscriptionNetworkMode } from '@shared/types'
import type { ApplicationContext } from '../../app/composition-root'
import { broadcastAppDataChange } from '../../ipc/broadcast'
import { formatZodError, isZodError } from '../../ipc/utils'

/** 注册点播源管理、文件导入导出和订阅同步 IPC 处理器 */
export function registerSourcesIpc(context: ApplicationContext): void {
  const { source, iptvSource, settings } = context.services
  const { subscriptionHttpClients } = context.utilities
  ipcMain.handle(IPC_CHANNELS.sources.list, () => source.list())
  ipcMain.handle(IPC_CHANNELS.sources.create, (_event, input: Parameters<AppApi['sources']['create']>[0]) => {
    const result = source.create(input)
    broadcastAppDataChange('vod-sources')
    return result
  })
  ipcMain.handle(
    IPC_CHANNELS.sources.update,
    (_event, id: string, input: Parameters<AppApi['sources']['update']>[1]) => {
      const result = source.update(id, input)
      broadcastAppDataChange('vod-sources')
      return result
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.sources.switchBackup,
    (_event, id: string, backupUrl: Parameters<AppApi['sources']['switchBackup']>[1]) => {
      const result = source.switchBackup(id, backupUrl)
      broadcastAppDataChange('vod-sources')
      return result
    },
  )
  ipcMain.handle(IPC_CHANNELS.sources.testSpeed, (_event, id: string) => source.testSpeed(id))
  ipcMain.handle(IPC_CHANNELS.sources.reorder, (_event, ids: Parameters<AppApi['sources']['reorder']>[0]) => {
    const result = source.reorder(ids)
    broadcastAppDataChange('vod-sources')
    return result
  })
  ipcMain.handle(IPC_CHANNELS.sources.delete, (_event, id: string) => {
    const result = source.delete(id)
    broadcastAppDataChange('vod-sources')
    return result
  })
  ipcMain.handle(IPC_CHANNELS.sources.clear, () => {
    const result = source.clear()
    broadcastAppDataChange('vod-sources')
    return result
  })
  ipcMain.handle(IPC_CHANNELS.sources.previewImport, (_event, payload: unknown) => source.previewImport(payload))
  ipcMain.handle(IPC_CHANNELS.sources.confirmImport, (_event, payload: unknown) => {
    const result = source.confirmImport(payload)
    broadcastAppDataChange('vod-sources')
    return result
  })
  ipcMain.handle(IPC_CHANNELS.sources.importFromFile, async (event) => {
    const window = requireWindow(event.sender)
    const result = await dialog.showOpenDialog(window, {
      title: '导入数据源 JSON',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePaths[0])
      return { cancelled: true, created: [], overwritten: [], skipped: [], invalid: [] }
    const filePath = result.filePaths[0]
    const imported = source.confirmImport(JSON.parse(await readFile(filePath, 'utf8')))
    broadcastAppDataChange('vod-sources')
    return { ...imported, filePath, cancelled: false }
  })
  ipcMain.handle(IPC_CHANNELS.sources.exportToFile, async (event) => {
    const window = requireWindow(event.sender)
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
    async (
      _event,
      subscriptionId: Parameters<AppApi['sources']['syncSubscription']>[0],
      mode: Parameters<AppApi['sources']['syncSubscription']>[1],
    ) => {
      if (!isSubscriptionNetworkMode(mode)) throw new Error('订阅更新网络模式无效')
      const subscription = settings.get().subscriptions.find((item) => item.id === subscriptionId)
      if (!subscription) throw new Error('订阅源不存在')
      const parsedUrl = new URL(subscription.url)
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('订阅地址仅支持 HTTP 或 HTTPS')
      const encoded = await subscriptionHttpClients[mode].get<string>(parsedUrl.toString(), {
        requestLabel: mode === 'direct' ? '订阅直连更新' : '订阅系统代理更新',
        responseType: 'text',
        maxContentLength: 2 * 1024 * 1024,
      })
      try {
        // 解码后使用 Schema 校验订阅内容。
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bs58.decode(encoded.trim()))
        const payload = sourceSubscriptionSchema.parse(JSON.parse(decoded))
        // 在同一事务中更新 VOD 源、IPTV 源和当前订阅。
        const result = context.db.$client.transaction(() => {
          const result = {
            vod: source.syncSubscription(payload.vod),
            iptv: iptvSource.syncSubscription(payload.iptv),
            updatedAt: Date.now(),
          }
          settings.update({ activeSubscriptionId: subscriptionId })
          return result
        })()
        broadcastAppDataChange('app-data')
        return result
      } catch (error) {
        if (error instanceof SyntaxError) throw new Error('订阅内容解码后不是有效的 JSON')
        if (isZodError(error)) throw new Error(`订阅配置格式无效：${formatZodError(error)}`)
        throw error
      }
    },
  )
  ipcMain.handle(IPC_CHANNELS.sources.deleteSubscription, (_event, subscriptionId: string) => {
    const current = settings.get()
    if (!current.subscriptions.some((item) => item.id === subscriptionId)) throw new Error('订阅源不存在')
    if (current.activeSubscriptionId === subscriptionId) {
      context.repositories.source.clearSubscription()
      context.repositories.iptvSource.clearSubscription()
    }
    const subscriptions = current.subscriptions.filter((item) => item.id !== subscriptionId)
    settings.update({
      subscriptions,
      activeSubscriptionId:
        current.activeSubscriptionId === subscriptionId ? subscriptions[0]?.id : current.activeSubscriptionId,
    })
    broadcastAppDataChange('app-data')
  })
}

function isSubscriptionNetworkMode(value: unknown): value is SubscriptionNetworkMode {
  return value === 'direct' || value === 'system'
}

function requireWindow(sender: WebContents): BrowserWindow {
  const window = BrowserWindow.fromWebContents(sender)
  if (!window) throw new Error('The requesting window is not available')
  return window
}
