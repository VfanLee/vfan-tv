import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { readFile, writeFile } from 'fs/promises'
import { DEFAULT_IPTV_SOURCES_EXPORT_NAME } from '@shared/constants'
import { IPC_CHANNELS } from '@shared/ipc'
import type { AppApi } from '@shared/types'
import type { ApplicationContext } from '../../app/composition-root'

// IPTV 源的文件读写与播放列表读取均留在 main 进程执行。
export function registerIptvSourcesIpc(context: ApplicationContext): void {
  const { iptvSource, iptvCatalog, iptvEpg, iptvPlayback, mediaPlaybackTarget } = context.services
  ipcMain.handle(IPC_CHANNELS.iptvSources.list, () => iptvSource.list())
  ipcMain.handle(IPC_CHANNELS.iptvSources.create, (_event, input: Parameters<AppApi['iptvSources']['create']>[0]) =>
    iptvSource.create(input),
  )
  ipcMain.handle(
    IPC_CHANNELS.iptvSources.update,
    (_event, id: string, input: Parameters<AppApi['iptvSources']['update']>[1]) => iptvSource.update(id, input),
  )
  ipcMain.handle(IPC_CHANNELS.iptvSources.reorder, (_event, ids: Parameters<AppApi['iptvSources']['reorder']>[0]) =>
    iptvSource.reorder(ids),
  )
  ipcMain.handle(IPC_CHANNELS.iptvSources.delete, (_event, id: string) => iptvSource.delete(id))
  ipcMain.handle(IPC_CHANNELS.iptvSources.clear, () => iptvSource.clear())
  ipcMain.handle(IPC_CHANNELS.iptvSources.previewImport, (_event, payload: unknown) =>
    iptvSource.previewImport(payload),
  )
  ipcMain.handle(IPC_CHANNELS.iptvSources.confirmImport, (_event, payload: unknown) =>
    iptvSource.confirmImport(payload),
  )
  ipcMain.handle(IPC_CHANNELS.iptvSources.importFromFile, async () => {
    const window = requireWindow(context)
    const result = await dialog.showOpenDialog(window, {
      title: '导入 IPTV 源 JSON',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePaths[0])
      return { cancelled: true, created: [], overwritten: [], skipped: [], invalid: [] }
    const filePath = result.filePaths[0]
    return { ...iptvSource.confirmImport(JSON.parse(await readFile(filePath, 'utf8'))), filePath, cancelled: false }
  })
  ipcMain.handle(IPC_CHANNELS.iptvSources.exportToFile, async () => {
    const window = requireWindow(context)
    const items = iptvSource.exportItems()
    const result = await dialog.showSaveDialog(window, {
      title: '导出 IPTV 源 JSON',
      defaultPath: DEFAULT_IPTV_SOURCES_EXPORT_NAME,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return { cancelled: true, count: 0 }
    await writeFile(result.filePath, `${JSON.stringify(items, null, 2)}\n`, 'utf8')
    return { cancelled: false, filePath: result.filePath, count: items.length }
  })
  ipcMain.handle(
    IPC_CHANNELS.iptv.getCatalog,
    async (_event, sourceId: Parameters<AppApi['iptv']['getCatalog']>[0], force?: boolean) => {
      if (force) mediaPlaybackTarget.clearDetectionCache()
      return logIptvRequest(context, '频道目录', 'content', async () => {
        const result = await iptvCatalog.get(sourceId, force)
        return { result, summary: `频道数=${result.channels.length} | 缓存=${result.cached ? '是' : '否'}` }
      })
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.iptv.getPrograms,
    (_event, sourceId: string, channelIds: Parameters<AppApi['iptv']['getPrograms']>[1]) =>
      logIptvRequest(context, '节目单', 'content', async () => {
        const result = await iptvEpg.getPrograms(sourceId, channelIds)
        return { result, summary: `频道数=${channelIds.length} | 结果数=${result.items.length}` }
      }),
  )
  ipcMain.handle(IPC_CHANNELS.iptv.getProgramSchedule, (_event, sourceId: string, channelId: string, date: string) =>
    logIptvRequest(context, '单日节目单', 'content', async () => {
      const result = await iptvEpg.getProgramSchedule(sourceId, channelId, date)
      return { result, summary: `日期=${sanitizeLogValue(date)} | 节目数=${result.programs.length}` }
    }),
  )
  ipcMain.handle(
    IPC_CHANNELS.iptv.getPlaybackTarget,
    (_event, sourceId: string, channelId: string, streamId: string) => {
      const requestId = randomUUID()
      return logIptvRequest(
        context,
        '播放解析',
        'playback',
        async () => {
          const result = await iptvPlayback.getTarget(sourceId, channelId, streamId, requestId)
          return {
            result,
            summary: `mediaSessionId=${result.mediaSessionId} | 类型=${result.streamType}`,
          }
        },
        requestId,
      )
    },
  )
  ipcMain.handle(IPC_CHANNELS.iptv.testEpg, (_event, settings?: Parameters<AppApi['iptv']['testEpg']>[0]) =>
    iptvEpg.test(settings),
  )
}

async function logIptvRequest<T>(
  context: ApplicationContext,
  action: string,
  route: 'content' | 'playback',
  task: () => Promise<{ result: T; summary?: string }>,
  requestId = randomUUID(),
): Promise<T> {
  const startedAt = Date.now()
  const network = context.services.network.getStatus().routes[route]
  const networkLabel =
    network.mode === 'direct'
      ? route === 'content'
        ? '内容直连'
        : '视频直连'
      : network.mode === 'system'
        ? '跟随系统'
        : `自定义代理(${sanitizeLogValue(network.activeProfileName ?? '未选择')})`
  console.info(`[IPTV ${action}] 开始 | requestId=${requestId} | 网络=${networkLabel}`)
  try {
    const { result, summary } = await task()
    console.info(
      `[IPTV ${action}] 成功 | requestId=${requestId} | 网络=${networkLabel}${summary ? ` | ${summary}` : ''} | 耗时=${Date.now() - startedAt}ms`,
    )
    return result
  } catch (error) {
    console.warn(
      `[IPTV ${action}] 失败 | requestId=${requestId} | 网络=${networkLabel} | 原因=${sanitizeLogValue(error instanceof Error ? error.message : String(error))} | 耗时=${Date.now() - startedAt}ms`,
    )
    throw error
  }
}

function sanitizeLogValue(value: string): string {
  return value
    .replace(/https?:\/\/[^\s)]+/gi, '[已脱敏地址]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 160)
}

function requireWindow(context: ApplicationContext): BrowserWindow {
  const window = context.getMainWindow()
  if (!window) throw new Error('Main window is not available')
  return window
}
