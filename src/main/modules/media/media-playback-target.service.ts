import type {
  IptvStreamRequestHeaders,
  LinkPlaybackNetworkMode,
  MediaPlaybackCandidate,
  MediaPlaybackTarget,
  MediaPlaybackTargetInput,
  MediaStreamDetectionResult,
  VodSourceConfig,
} from '@shared/types'
import { randomUUID } from 'crypto'
import type { ContentNetworkContext, ContentNetworkService } from '../../infrastructure/network/content-network.service'
import { resolveSourceRequestHeaders } from '../../infrastructure/http/source-request-headers'
import type { MediaProxyServer } from './media-proxy-server'
import { detectKnownMediaStreamTypeFromUrl, detectMediaStreamType } from './media-stream-detector.service'

const DETECTION_CACHE_LIMIT = 512
const DETECTION_CACHE_TTL_MS = 30 * 60 * 1_000
const MAX_CONCURRENT_DETECTIONS = 3

interface DetectionCacheEntry {
  expiresAt: number
  result: MediaStreamDetectionResult
}

export class MediaPlaybackTargetService {
  private readonly detectionCache = new Map<string, DetectionCacheEntry>()
  private readonly detectionTasks = new Map<string, Promise<MediaStreamDetectionResult>>()
  private readonly detectionWaiters: Array<() => void> = []
  private activeDetections = 0
  private detectionCacheGeneration = 0

  constructor(
    private readonly mediaProxy: MediaProxyServer,
    private readonly network: ContentNetworkService,
  ) {}

  async resolve(
    input: MediaPlaybackTargetInput,
    source?: VodSourceConfig,
    requestId: string = randomUUID(),
  ): Promise<MediaPlaybackTarget> {
    if (!input || typeof input !== 'object') throw new Error('播放地址无效')
    const candidates = parsePlaybackCandidates(input.candidates)
    const route = getPlaybackNetworkRoute(input.networkMode, source !== undefined)
    return this.network.withContext(route, async (context) => {
      const failures: string[] = []
      for (const candidate of prioritizeCandidates(candidates)) {
        try {
          const headers = source ? resolveSourceRequestHeaders(source.url, candidate.url, source.headers) : {}
          const target = await this.resolveTarget(candidate.url, { headers }, context, requestId)
          return {
            ...target,
            selectedCandidateId: candidate.id,
            selectedCandidateName: candidate.name,
          }
        } catch (error) {
          failures.push(`${candidate.name}：${getCandidateErrorMessage(error)}`)
        }
      }
      throw new Error(`全部播放线路均不可用：${failures.join('；')}`)
    })
  }

  async resolveWithHeaders(
    url: string,
    requestHeaders: IptvStreamRequestHeaders,
    requestId: string = randomUUID(),
  ): Promise<MediaPlaybackTarget> {
    const targetUrl = parsePlaybackUrl(url)
    return this.network.withIptvContext((context) => this.resolveTarget(targetUrl, requestHeaders, context, requestId))
  }

  clearDetectionCache(): void {
    this.detectionCacheGeneration += 1
    this.detectionCache.clear()
    this.detectionTasks.clear()
  }

  private async resolveTarget(
    url: string,
    requestHeaders: IptvStreamRequestHeaders,
    context: ContentNetworkContext,
    requestId: string,
  ): Promise<MediaPlaybackTarget> {
    const targetUrl = parsePlaybackUrl(url)
    const knownType = detectKnownMediaStreamTypeFromUrl(targetUrl)
    const startedAt = Date.now()
    const detection = knownType
      ? { type: knownType }
      : await this.detect(targetUrl, requestHeaders.headers ?? {}, context)
    if (knownType) {
      console.info(
        `[媒体解析] 按扩展名识别（尚未验证） | requestId=${requestId} | 类型=${knownType} | 目标=${formatTargetForLog(targetUrl)}`,
      )
    } else {
      const message = [
        detection.errorMessage ? '[媒体解析] 探测失败' : '[媒体解析] 探测成功',
        `requestId=${requestId}`,
        `网络=${this.network.getRouteDescription(context.route)}`,
        `状态码=${detection.statusCode ?? '—'}`,
        `Content-Type=${sanitizeContentType(detection.contentType)}`,
        `类型=${detection.type}`,
        `目标=${formatTargetForLog(detection.finalUrl ?? targetUrl)}`,
        `耗时=${Date.now() - startedAt}ms`,
        ...(detection.errorMessage ? [`原因=${detection.errorMessage}`] : []),
      ].join(' | ')
      if (detection.errorMessage) console.warn(message)
      else console.info(message)
    }
    if (detection.errorMessage) throw new Error(detection.errorMessage)
    const session = await this.mediaProxy.createMediaSession(
      targetUrl,
      requestHeaders,
      context,
      detection.type,
      requestId,
    )
    return { ...session, streamType: detection.type }
  }

  private detect(
    url: string,
    headers: Record<string, string>,
    context: ContentNetworkContext,
  ): Promise<MediaStreamDetectionResult> {
    const key = createDetectionCacheKey(context.id, url, headers)
    const cached = this.detectionCache.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      this.detectionCache.delete(key)
      this.detectionCache.set(key, cached)
      return Promise.resolve(cached.result)
    }
    if (cached) this.detectionCache.delete(key)

    const pending = this.detectionTasks.get(key)
    if (pending) return pending

    const generation = this.detectionCacheGeneration
    const task = this.runDetection(url, headers, context)
      .then((result) => {
        if (generation !== this.detectionCacheGeneration || result.errorMessage) return result
        this.detectionCache.set(key, {
          result,
          expiresAt: Date.now() + DETECTION_CACHE_TTL_MS,
        })
        while (this.detectionCache.size > DETECTION_CACHE_LIMIT) {
          this.detectionCache.delete(this.detectionCache.keys().next().value as string)
        }
        return result
      })
      .finally(() => {
        if (this.detectionTasks.get(key) === task) this.detectionTasks.delete(key)
      })
    this.detectionTasks.set(key, task)
    return task
  }

  private async runDetection(
    url: string,
    headers: Record<string, string>,
    context: ContentNetworkContext,
  ): Promise<MediaStreamDetectionResult> {
    await this.acquireDetectionSlot()
    try {
      return await detectMediaStreamType({ url, headers }, this.network, context)
    } finally {
      this.releaseDetectionSlot()
    }
  }

  private async acquireDetectionSlot(): Promise<void> {
    if (this.activeDetections < MAX_CONCURRENT_DETECTIONS) {
      this.activeDetections += 1
      return
    }
    await new Promise<void>((resolve) => this.detectionWaiters.push(resolve))
  }

  private releaseDetectionSlot(): void {
    const next = this.detectionWaiters.shift()
    if (next) {
      next()
      return
    }
    this.activeDetections = Math.max(0, this.activeDetections - 1)
  }
}

function getPlaybackNetworkRoute(
  networkMode: LinkPlaybackNetworkMode | undefined,
  hasVodSource: boolean,
): 'vodPlayback' | 'linkPlaybackDirect' | 'linkPlaybackSystem' {
  if (hasVodSource || networkMode === undefined) return 'vodPlayback'
  if (networkMode === 'direct') return 'linkPlaybackDirect'
  if (networkMode === 'system') return 'linkPlaybackSystem'
  throw new Error('URL 解析播放网络模式无效')
}

function formatTargetForLog(value: string): string {
  const url = new URL(value)
  return `${url.protocol}//${url.host}${url.pathname === '/' ? '/' : '/…'}${url.search ? '?…' : ''}`
}

function sanitizeContentType(value: string | undefined): string {
  return value?.split(';', 1)[0]?.trim().slice(0, 80) || '—'
}

function parsePlaybackCandidates(value: MediaPlaybackCandidate[]): MediaPlaybackCandidate[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('没有可用的播放线路')
  const candidates: MediaPlaybackCandidate[] = []
  const ids = new Set<string>()
  for (const item of value.slice(0, 32)) {
    if (!item || typeof item !== 'object') continue
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!id || ids.has(id)) continue
    let url: string
    try {
      url = parsePlaybackUrl(item.url)
    } catch {
      continue
    }
    ids.add(id)
    candidates.push({ id, name: name || `线路 ${candidates.length + 1}`, url })
  }
  if (candidates.length === 0) throw new Error('没有可用的播放线路')
  return candidates
}

function prioritizeCandidates(candidates: MediaPlaybackCandidate[]): MediaPlaybackCandidate[] {
  return candidates
    .map((candidate, index) => ({ candidate, index, score: getCandidatePriority(candidate) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ candidate }) => candidate)
}

function getCandidatePriority(candidate: MediaPlaybackCandidate): number {
  const knownType = detectKnownMediaStreamTypeFromUrl(candidate.url)
  if (knownType === 'hls') return 500
  if (knownType === 'flv' || knownType === 'mpegts') return 450
  if (knownType === 'native') return 400
  if (/m3u8/i.test(candidate.name)) return 300
  try {
    if (new URL(candidate.url).pathname.toLowerCase().includes('/share/')) return -100
  } catch {
    return -200
  }
  return 100
}

function getCandidateErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message
      .replace(/[\r\n\t]+/g, ' ')
      .trim()
      .slice(0, 120) || '解析失败'
  )
}

function parsePlaybackUrl(value: string): string {
  if (typeof value !== 'string') throw new Error('播放地址无效')
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('播放地址无效')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 HTTP 或 HTTPS 播放地址')
  return url.toString()
}

function createDetectionCacheKey(contextId: string, url: string, headers: Record<string, string>): string {
  const normalizedHeaders = Object.entries(headers)
    .map(([name, value]) => [name.trim().toLowerCase(), value] as const)
    .sort(([left], [right]) => left.localeCompare(right))
  return JSON.stringify([contextId, url, normalizedHeaders])
}
