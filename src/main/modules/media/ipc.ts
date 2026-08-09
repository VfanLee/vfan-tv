import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { IPC_CHANNELS } from '@shared/ipc'
import type { AppApi, MediaImageSourceType } from '@shared/types'
import { resolveImageTarget } from '@shared/utils/media-image'
import type { ApplicationContext } from '../../app/composition-root'
import { resolveSourceRequestHeaders } from '../../infrastructure/http/source-request-headers'
import type { ContentNetworkRoute } from '../../infrastructure/network/content-network.service'

export function registerMediaIpc(context: ApplicationContext): void {
  const { vodCatalog, vodSearch, mediaProxy, mediaPlaybackTarget } = context.services
  const { probeMediaSource } = context.utilities
  ipcMain.handle(IPC_CHANNELS.vod.search, (_event, keyword: string) => vodSearch.search(keyword))
  ipcMain.handle(IPC_CHANNELS.vod.cancelSearch, (_event, searchId: string) => vodSearch.cancel(searchId))
  ipcMain.handle(IPC_CHANNELS.vod.getCatalogPage, (_event, input: Parameters<AppApi['vod']['getCatalogPage']>[0]) =>
    vodCatalog.getPage(input),
  )
  ipcMain.handle(IPC_CHANNELS.vod.getDetail, (_event, sourceId: string, vodId: string) =>
    vodCatalog.getDetail(sourceId, vodId),
  )
  ipcMain.handle(IPC_CHANNELS.vod.probeMedia, (_event, input: Parameters<AppApi['vod']['probeMedia']>[0]) => {
    const source = context.repositories.source.findById(input.sourceId)
    if (!source) throw new Error('点播源不存在')
    return probeMediaSource(input, source)
  })
  ipcMain.handle(
    IPC_CHANNELS.media.getPlaybackTarget,
    async (_event, input: Parameters<AppApi['media']['getPlaybackTarget']>[0]) => {
      const startedAt = Date.now()
      const requestId = randomUUID()
      const diagnostics = formatPlaybackDiagnostics(input, context.services.network.getStatus())
      console.info(`[媒体解析] 开始 | requestId=${requestId} | ${diagnostics}`)
      try {
        const source = input.sourceId ? context.repositories.source.findById(input.sourceId) : undefined
        if (input.sourceId && !source) throw new Error('点播源不存在')
        const target = await mediaPlaybackTarget.resolve(input, source, requestId)
        const selectedCandidate = input.candidates.find((candidate) => candidate.id === target.selectedCandidateId)
        console.info(
          `[媒体解析] 成功 | requestId=${requestId} | mediaSessionId=${target.mediaSessionId} | ${diagnostics} | 选中=${sanitizeLogText(target.selectedCandidateName ?? '默认线路')} | 类型=${target.streamType} | 目标=${formatUrlForLog(selectedCandidate?.url)} | 耗时=${Date.now() - startedAt}ms`,
        )
        return { ok: true, target } as const
      } catch (error) {
        const errorMessage = getSafeMediaErrorMessage(error)
        console.warn(
          `[媒体解析] 失败 | requestId=${requestId} | ${diagnostics} | 原因=${errorMessage} | 耗时=${Date.now() - startedAt}ms`,
        )
        return { ok: false, errorMessage } as const
      }
    },
  )
  ipcMain.handle(IPC_CHANNELS.media.getAssociatedAudioUrl, async (_event, mediaSessionId: string, url: string) => {
    if (typeof mediaSessionId !== 'string' || typeof url !== 'string') throw new Error('播放地址无效')
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return url
    if (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') return url
    return mediaProxy.createAssociatedAudioUrl(mediaSessionId, parsed.toString())
  })
  ipcMain.handle(
    IPC_CHANNELS.media.getImageUrl,
    async (_event, sourceType: MediaImageSourceType, sourceId: string | undefined, url: string, baseUrl?: string) => {
      if (
        typeof url !== 'string' ||
        (sourceId !== undefined && typeof sourceId !== 'string') ||
        !isMediaImageSourceType(sourceType)
      ) {
        throw new Error('海报请求参数无效')
      }
      const targetUrl = resolveImageTarget(url, typeof baseUrl === 'string' ? baseUrl : undefined)
      if (!targetUrl) return url
      const source = sourceId
        ? sourceType === 'iptv'
          ? context.repositories.iptvSource.findById(sourceId)
          : sourceType === 'vod'
            ? context.repositories.source.findById(sourceId)
            : undefined
        : undefined
      const rawHeaders = Object.fromEntries(
        Object.entries(source?.headers ?? {}).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
      const headers = source ? resolveSourceRequestHeaders(source.url, targetUrl, rawHeaders) : {}
      return mediaProxy.createImageUrl(
        targetUrl,
        headers,
        context.services.network.getContext(getImageNetworkRoute(sourceType)),
      )
    },
  )
  ipcMain.handle(IPC_CHANNELS.media.getPlaybackSessionInfo, (_event, mediaSessionId: string) =>
    mediaProxy.getPlaybackSessionInfo(mediaSessionId),
  )
  ipcMain.handle(IPC_CHANNELS.media.retainPlaybackSession, (_event, mediaSessionId: string) =>
    mediaProxy.retainPlaybackSession(mediaSessionId),
  )
  ipcMain.handle(IPC_CHANNELS.media.releasePlaybackSession, (_event, mediaSessionId: string) =>
    mediaProxy.releasePlaybackSession(mediaSessionId),
  )
  ipcMain.handle(
    IPC_CHANNELS.media.reportPlaybackEvent,
    (_event, event: Parameters<AppApi['media']['reportPlaybackEvent']>[0]) => mediaProxy.reportPlaybackEvent(event),
  )
}

function isMediaImageSourceType(value: unknown): value is MediaImageSourceType {
  return value === 'vod' || value === 'iptv' || value === 'douban' || value === 'radio'
}

function getImageNetworkRoute(sourceType: MediaImageSourceType): ContentNetworkRoute {
  if (sourceType === 'douban') return 'douban'
  if (sourceType === 'radio') return 'radio'
  return 'content'
}

function formatPlaybackDiagnostics(
  input: Parameters<AppApi['media']['getPlaybackTarget']>[0],
  network: ReturnType<ApplicationContext['services']['network']['getStatus']>,
): string {
  const diagnostics = input?.diagnostics
  return [
    diagnostics?.sourceName ? `来源=${sanitizeLogText(diagnostics.sourceName)}` : undefined,
    diagnostics?.episodeName ? `剧集=${sanitizeLogText(diagnostics.episodeName)}` : undefined,
    `候选=${formatCandidateNames(input?.candidates)}`,
    `网络=${formatPlaybackNetwork(network)}`,
  ]
    .filter(Boolean)
    .join(' | ')
}

function formatCandidateNames(candidates: Parameters<AppApi['media']['getPlaybackTarget']>[0]['candidates']): string {
  if (!Array.isArray(candidates) || candidates.length === 0) return '无'
  return candidates
    .slice(0, 8)
    .map((candidate) => sanitizeLogText(candidate.name || candidate.id, 32))
    .join(',')
}

function formatPlaybackNetwork(network: ReturnType<ApplicationContext['services']['network']['getStatus']>): string {
  const playback = network.routes.playback
  if (playback.mode === 'direct') return '视频直连'
  if (playback.mode === 'system') return '跟随系统'
  return playback.activeProfileName ? `自定义代理(${sanitizeLogText(playback.activeProfileName)})` : '自定义代理'
}

function getSafeMediaErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return sanitizeLogText(
    message.replace(/https?:\/\/[^\s)]+/gi, (url) => formatUrlForLog(url)),
    180,
  )
}

function formatUrlForLog(value: unknown): string {
  if (typeof value !== 'string') return '无效地址'
  try {
    const url = new URL(value)
    const path = url.pathname
      .split('/')
      .map((segment) => redactPathSegment(segment))
      .join('/')
    return `${url.protocol}//${url.host}${path || '/'}${url.search ? '?…' : ''}`
  } catch {
    return '无效地址'
  }
}

function redactPathSegment(value: string): string {
  if (value.length <= 40) return value
  return `${value.slice(0, 16)}…${value.slice(-8)}`
}

function sanitizeLogText(value: string, maxLength = 80): string {
  const normalized = value.replace(/[\r\n\t]+/g, ' ').trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}…`
}
