import { randomUUID } from 'crypto'
import { net } from 'electron'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type {
  IptvStreamRequestHeaders,
  MediaPlaybackEvent,
  MediaPlaybackSessionInfo,
  MediaStreamType,
} from '@shared/types'
import type { ContentNetworkContext, ContentNetworkService } from '../../infrastructure/network/content-network.service'
import { resolveSourceRequestHeaders } from '../../infrastructure/http/source-request-headers'

const PLAYLIST_CONTENT_TYPES = ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl']
const DOUBAN_IMAGE_REFERER = 'https://movie.douban.com/explore'
const MAX_PROXY_IMAGE_BYTES = 20 * 1024 * 1024

/** 代理媒体与图片请求，管理播放会话并重写 HLS 子资源地址 */
export class MediaProxyServer {
  private server?: Server
  private baseUrl?: string
  private startPromise?: Promise<string>
  private readonly bindings = new Map<string, ProxyBinding>()
  private readonly mediaSessions = new Map<string, MediaSession>()
  private readonly cleanupTimer: NodeJS.Timeout

  constructor(private readonly network: ContentNetworkService) {
    this.cleanupTimer = setInterval(() => this.pruneBindings(), 30 * 60 * 1_000)
    this.cleanupTimer.unref()
  }

  clearSessions(): void {
    for (const sessionId of [...this.mediaSessions.keys()]) this.destroyMediaSession(sessionId)
    for (const [token, binding] of this.bindings) {
      if (!binding.mediaSessionId) this.network.releaseContext(binding.context)
      this.bindings.delete(token)
    }
  }

  async createMediaSession(
    targetUrl: string,
    requestHeaders: IptvStreamRequestHeaders,
    context: ContentNetworkContext,
    streamType: MediaStreamType,
    requestId: string,
  ): Promise<{ src: string; mediaSessionId: string }> {
    const parsedTargetUrl = new URL(targetUrl)
    if (!['http:', 'https:'].includes(parsedTargetUrl.protocol)) throw new Error('仅支持 HTTP 或 HTTPS 播放地址')
    const mediaSessionId = randomUUID()
    this.network.retainContext(context)
    const mediaSession: MediaSession = {
      id: mediaSessionId,
      requestId,
      originalUrl: parsedTargetUrl.toString(),
      headerOriginUrl: parsedTargetUrl.toString(),
      headers: sanitizeMediaHeaders(requestHeaders.headers),
      context,
      streamType,
      createdAt: Date.now(),
      expiresAt: Date.now() + 12 * 60 * 60 * 1_000,
      references: 1,
      validated: false,
      tokens: new Set(),
    }
    this.mediaSessions.set(mediaSessionId, mediaSession)
    const token = this.registerSessionBinding(mediaSession, parsedTargetUrl.toString(), 'media')
    return { src: await this.createTokenUrl('media', token), mediaSessionId }
  }

  async createMediaUrl(
    targetUrl: string,
    requestHeaders: IptvStreamRequestHeaders,
    context: ContentNetworkContext,
  ): Promise<string> {
    const token = this.registerStandaloneBinding(targetUrl, requestHeaders.headers, context, 'media')
    return this.createTokenUrl('media', token)
  }

  async createImageUrl(
    targetUrl: string,
    headers: Record<string, string>,
    context: ContentNetworkContext,
  ): Promise<string> {
    const token = this.registerStandaloneBinding(targetUrl, headers, context, 'image')
    return this.createTokenUrl('image', token)
  }

  async createAssociatedAudioUrl(mediaSessionId: string, targetUrl: string): Promise<string> {
    const session = this.requireMediaSession(mediaSessionId)
    const token = this.registerSessionBinding(session, targetUrl, 'media')
    return this.createTokenUrl('media', token)
  }

  getPlaybackSessionInfo(mediaSessionId: string): MediaPlaybackSessionInfo {
    const value = this.requireMediaSession(mediaSessionId)
    return {
      mediaSessionId,
      originalUrl: value.originalUrl,
      finalUrl: value.finalUrl,
      streamType: value.streamType,
      network: this.network.getRouteDescription(value.context.route),
      createdAt: value.createdAt,
    }
  }

  retainPlaybackSession(mediaSessionId: string): void {
    const value = this.requireMediaSession(mediaSessionId)
    value.references += 1
    value.expiresAt = Date.now() + 12 * 60 * 60 * 1_000
  }

  releasePlaybackSession(mediaSessionId: string): void {
    const value = this.mediaSessions.get(mediaSessionId)
    if (!value) return
    value.references = Math.max(0, value.references - 1)
    if (value.references === 0) this.destroyMediaSession(mediaSessionId)
  }

  reportPlaybackEvent(event: MediaPlaybackEvent): void {
    const value = this.requireMediaSession(event.mediaSessionId)
    const fields = [
      `[媒体播放] ${getPlaybackEventLabel(event.type)}`,
      `requestId=${value.requestId}`,
      `mediaSessionId=${value.id}`,
      `网络=${this.network.getRouteDescription(value.context.route)}`,
      event.elapsedMs !== undefined ? `耗时=${Math.max(0, Math.round(event.elapsedMs))}ms` : undefined,
      event.success !== undefined ? `结果=${event.success ? '成功' : '失败'}` : undefined,
      event.message ? `原因=${sanitizeLogMessage(event.message)}` : undefined,
    ].filter(Boolean)
    console.info(fields.join(' | '))
  }

  getBaseUrl(): Promise<string> {
    if (this.baseUrl) {
      return Promise.resolve(this.baseUrl)
    }

    // 并发请求复用同一次服务器启动。
    if (!this.startPromise) {
      this.startPromise = this.start()
    }

    return this.startPromise
  }

  private start(): Promise<string> {
    this.server = createServer((request, response) => {
      void this.handleRequest(request, response)
    })

    return new Promise((resolve, reject) => {
      this.server?.once('error', reject)
      this.server?.listen(0, '127.0.0.1', () => {
        const address = this.server?.address()
        if (!address || typeof address === 'string') {
          reject(new Error('直播代理启动失败'))
          return
        }

        this.baseUrl = `http://127.0.0.1:${address.port}`
        resolve(this.baseUrl)
      })
    })
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const startedAt = Date.now()
    if (request.method === 'OPTIONS') {
      writeCorsHeaders(response)
      response.writeHead(204)
      response.end()
      return
    }

    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    const routeMatch = requestUrl.pathname.match(/^\/(media|image|resolve)\/([0-9a-f-]{36})$/i)
    if (!routeMatch) {
      response.writeHead(404)
      response.end('Not found')
      return
    }
    const route = routeMatch[1].toLowerCase() as ProxyBinding['kind']
    const token = routeMatch[2]
    let binding: ProxyBinding | undefined

    try {
      binding = this.getBinding(token, route)

      if (route === 'resolve') {
        this.network.retainContext(binding.context)
        try {
          await resolveMediaUrl(
            response,
            binding.targetUrl,
            binding.headers,
            this.network,
            binding.context,
            (finalUrl) => this.updateFinalUrl(binding!, finalUrl),
          )
        } finally {
          this.network.releaseContext(binding.context)
        }
        return
      }

      this.network.retainContext(binding.context)
      try {
        if (route === 'image' && binding.context.route === 'douban' && isDoubanImageUrl(binding.targetUrl)) {
          await proxyDoubanImageRequest(response, binding, (result) =>
            this.recordProxyResult(binding!, result, Date.now() - startedAt),
          )
          return
        }
        await proxyMediaRequest(
          request,
          response,
          binding.targetUrl,
          binding,
          this.network,
          (targetUrl) => this.createChildMediaUrl(binding!, targetUrl),
          (finalUrl) => this.updateFinalUrl(binding!, finalUrl),
          (result) => this.recordProxyResult(binding!, result, Date.now() - startedAt),
        )
      } finally {
        this.network.releaseContext(binding.context)
      }
    } catch (error) {
      if (isExpectedProxyCancellation(error, response)) return
      console.warn(
        `[本地媒体代理] 请求失败 | requestId=${this.getRequestId(binding)} | mediaSessionId=${binding?.mediaSessionId ?? '—'} | 类型=${getProxyRequestKind(route)} | 目标=${getSafeTargetHost(binding?.targetUrl)} | 原因=${getSafeProxyErrorMessage(error)}`,
      )
      if (!response.headersSent) {
        writeCorsHeaders(response)
        response.writeHead(502)
      }
      response.end('Failed to fetch media resource')
    }
  }

  private registerStandaloneBinding(
    targetUrl: string,
    headers: Record<string, string>,
    context: ContentNetworkContext,
    kind: ProxyBinding['kind'],
  ): string {
    const parsed = parseTargetUrl(targetUrl)
    const token = randomUUID()
    this.network.retainContext(context)
    this.bindings.set(token, {
      token,
      requestId: randomUUID(),
      kind,
      targetUrl: parsed,
      headerOriginUrl: parsed,
      headers: sanitizeMediaHeaders(headers),
      context,
      expiresAt: Date.now() + 12 * 60 * 60 * 1_000,
    })
    this.pruneBindings()
    return token
  }

  private registerSessionBinding(session: MediaSession, targetUrl: string, kind: ProxyBinding['kind']): string {
    const token = randomUUID()
    this.bindings.set(token, {
      token,
      requestId: session.requestId,
      kind,
      targetUrl: parseTargetUrl(targetUrl),
      headerOriginUrl: session.headerOriginUrl,
      headers: session.headers,
      context: session.context,
      mediaSessionId: session.id,
      expiresAt: session.expiresAt,
    })
    session.tokens.add(token)
    return token
  }

  private getBinding(token: string, kind: ProxyBinding['kind']): ProxyBinding {
    const value = this.bindings.get(token)
    if (!value || value.kind !== kind || value.expiresAt <= Date.now()) {
      this.removeBinding(token)
      throw new Error('媒体请求令牌已失效')
    }
    value.expiresAt = Date.now() + 12 * 60 * 60 * 1_000
    // Map 保留插入顺序；重新插入后，容量清理会优先淘汰长期未访问的分片地址。
    this.bindings.delete(token)
    this.bindings.set(token, value)
    const mediaSession = value.mediaSessionId ? this.mediaSessions.get(value.mediaSessionId) : undefined
    if (value.mediaSessionId && !mediaSession) throw new Error('媒体播放会话已失效')
    if (mediaSession) mediaSession.expiresAt = value.expiresAt
    return value
  }

  private requireMediaSession(mediaSessionId: string): MediaSession {
    const value = this.mediaSessions.get(mediaSessionId)
    if (!value || value.expiresAt <= Date.now()) {
      this.destroyMediaSession(mediaSessionId)
      throw new Error('媒体播放会话已失效')
    }
    return value
  }

  private async createTokenUrl(kind: ProxyBinding['kind'], token: string): Promise<string> {
    return new URL(`/${kind}/${token}`, await this.getBaseUrl()).toString()
  }

  private createChildMediaUrl(binding: ProxyBinding, targetUrl: string): string {
    const token = binding.mediaSessionId
      ? this.registerSessionBinding(this.requireMediaSession(binding.mediaSessionId), targetUrl, 'media')
      : this.registerStandaloneBinding(targetUrl, binding.headers, binding.context, 'media')
    return new URL(`/media/${token}`, this.baseUrl).toString()
  }

  private updateFinalUrl(binding: ProxyBinding, finalUrl: string): void {
    if (!binding.mediaSessionId) return
    const session = this.mediaSessions.get(binding.mediaSessionId)
    if (session && binding.targetUrl === session.originalUrl) session.finalUrl = finalUrl
  }

  private recordProxyResult(binding: ProxyBinding, result: ProxyRequestResult, elapsedMs: number): void {
    const session = binding.mediaSessionId ? this.mediaSessions.get(binding.mediaSessionId) : undefined
    const fields = [
      `requestId=${binding.requestId}`,
      `mediaSessionId=${binding.mediaSessionId ?? '—'}`,
      `网络=${this.network.getRouteDescription(binding.context.route)}`,
      `状态码=${result.status}`,
      `Content-Type=${sanitizeContentType(result.contentType)}`,
      `目标=${getSafeTargetHost(result.finalUrl)}`,
      `耗时=${elapsedMs}ms`,
    ]
    if (result.status >= 400) {
      console.warn(`[媒体请求] 失败 | ${fields.join(' | ')}`)
      return
    }
    if (binding.kind === 'image') return
    if (session && !session.validated) {
      session.validated = true
      console.info(`[媒体请求] 首次验证成功 | ${fields.join(' | ')}`)
      return
    }
    if (result.isPlaylist) console.info(`[媒体清单] 加载成功 | ${fields.join(' | ')}`)
  }

  private getRequestId(binding?: ProxyBinding): string {
    return binding?.requestId ?? 'unknown'
  }

  private pruneBindings(): void {
    const now = Date.now()
    for (const [sessionId, value] of this.mediaSessions) {
      if (value.expiresAt <= now) this.destroyMediaSession(sessionId)
    }
    for (const [token, value] of this.bindings) {
      if (value.expiresAt <= now) this.removeBinding(token)
    }
    while (this.bindings.size > 768) {
      const oldestToken = this.bindings.keys().next().value
      if (!oldestToken) break
      this.removeBinding(oldestToken)
    }
  }

  private removeBinding(token: string): void {
    const value = this.bindings.get(token)
    if (!value) return
    this.bindings.delete(token)
    if (value.mediaSessionId) {
      this.mediaSessions.get(value.mediaSessionId)?.tokens.delete(token)
    } else {
      this.network.releaseContext(value.context)
    }
  }

  private destroyMediaSession(mediaSessionId: string): void {
    const value = this.mediaSessions.get(mediaSessionId)
    if (!value) return
    this.mediaSessions.delete(mediaSessionId)
    for (const token of value.tokens) this.bindings.delete(token)
    this.network.releaseContext(value.context)
  }
}

interface ProxyBinding {
  token: string
  requestId: string
  kind: 'media' | 'image' | 'resolve'
  targetUrl: string
  headerOriginUrl: string
  headers: Record<string, string>
  context: ContentNetworkContext
  mediaSessionId?: string
  expiresAt: number
}

function parseTargetUrl(targetUrl: string): string {
  const parsed = new URL(targetUrl)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('仅支持 HTTP 或 HTTPS 媒体地址')
  return parsed.toString()
}

function getPlaybackEventLabel(type: MediaPlaybackEvent['type']): string {
  if (type === 'first-frame') return '首帧成功'
  if (type === 'player-error') return '播放器错误'
  if (type === 'manual-route-switch') return '手动换线'
  return '自动换线'
}

function sanitizeLogMessage(value: string): string {
  return value
    .replace(/https?:\/\/[^\s)]+/gi, '[已脱敏地址]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 180)
}

interface MediaSession {
  id: string
  requestId: string
  originalUrl: string
  finalUrl?: string
  headerOriginUrl: string
  headers: Record<string, string>
  context: ContentNetworkContext
  streamType: MediaStreamType
  createdAt: number
  expiresAt: number
  references: number
  validated: boolean
  tokens: Set<string>
}

interface ProxyRequestResult {
  status: number
  contentType: string
  finalUrl: string
  isPlaylist: boolean
}

function sanitizeContentType(value: string): string {
  return value.split(';', 1)[0].trim().slice(0, 80) || '未提供'
}

function getSafeProxyErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return '请求已取消'
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (message.includes('invalid referrer') || message.includes('invalid referer')) return 'Referer 无效'
  if (message.includes('timeout') || message.includes('timed out')) return '连接超时'
  if (message.includes('enotfound') || message.includes('name_not_resolved')) return '域名解析失败'
  if (message.includes('econnrefused') || message.includes('connection_refused')) return '连接被拒绝'
  if (message.includes('certificate') || message.includes('cert_')) return '证书校验失败'
  return '无法连接上游资源'
}

function isExpectedProxyCancellation(error: unknown, response: ServerResponse): boolean {
  return response.destroyed && error instanceof DOMException && error.name === 'AbortError'
}

function getProxyRequestKind(pathname: string): string {
  if (pathname === 'image') return '图片'
  if (pathname === 'resolve') return '地址解析'
  return '视频'
}

function getSafeTargetHost(targetUrl?: string): string {
  if (!targetUrl) return 'unknown-target'
  try {
    return new URL(targetUrl).host
  } catch {
    return 'invalid-target'
  }
}

/** 跟随媒体重定向并返回最终地址 */
async function resolveMediaUrl(
  response: ServerResponse,
  targetUrl: string,
  configuredHeaders: Record<string, string>,
  network: ContentNetworkService,
  context: ContentNetworkContext,
  onResolved: (url: string) => void,
): Promise<void> {
  const resolvedUrl = await followRedirectsOnly(targetUrl, configuredHeaders, network, context)
  onResolved(resolvedUrl)
  const body = JSON.stringify({ url: resolvedUrl })
  writeCorsHeaders(response)
  response.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body, 'utf-8'),
    'Cache-Control': 'no-cache',
  })
  response.end(body)
}

async function followRedirectsOnly(
  targetUrl: string,
  configuredHeaders: Record<string, string>,
  network: ContentNetworkService,
  context: ContentNetworkContext,
): Promise<string> {
  const upstream = await network.fetchWithRedirects(
    targetUrl,
    {
      headers: getResolveRequestHeaders(configuredHeaders),
      signal: AbortSignal.timeout(12_000),
    },
    context,
    targetUrl,
  )
  const resolvedUrl = upstream.url || targetUrl
  // 只需要最终地址，读取响应头后立即断开媒体响应。
  await upstream.body?.cancel().catch(() => undefined)
  return resolvedUrl
}

function getResolveRequestHeaders(configuredHeaders: Record<string, string>): Record<string, string> {
  const sanitizedHeaders = sanitizeMediaHeaders(configuredHeaders)
  const headers: Record<string, string> = {
    ...sanitizedHeaders,
    'Accept': '*/*',
    'Accept-Encoding': 'identity',
  }
  return headers
}

async function proxyMediaRequest(
  request: IncomingMessage,
  response: ServerResponse,
  targetUrl: string,
  binding: ProxyBinding,
  network: ContentNetworkService,
  createChildUrl: (targetUrl: string) => string,
  onResolved: (url: string) => void,
  onResult: (result: ProxyRequestResult) => void,
): Promise<void> {
  const abortController = new AbortController()
  response.once('close', () => abortController.abort())

  const upstream = await network.fetchWithRedirects(
    targetUrl,
    {
      headers: getRequestHeaders(
        request,
        targetUrl,
        resolveSourceRequestHeaders(binding.headerOriginUrl, targetUrl, binding.headers),
      ),
      redirect: 'follow',
      signal: abortController.signal,
    },
    binding.context,
    binding.headerOriginUrl,
  )

  const contentType = upstream.headers.get('content-type') ?? ''
  const status = normalizeStatus(upstream.status)
  const responseUrl = upstream.url || targetUrl
  onResolved(responseUrl)
  const isLiveMedia = isLiveMediaUrl(responseUrl, contentType)
  const playlist = isPlaylist(responseUrl, contentType)
  onResult({ status, contentType, finalUrl: responseUrl, isPlaylist: playlist })

  if (playlist) {
    const body = Buffer.from(await upstream.arrayBuffer())
    const rewrittenPlaylist = rewritePlaylist(body.toString('utf-8'), responseUrl, createChildUrl)
    const headers = createResponseHeaders(
      contentType || 'application/vnd.apple.mpegurl',
      Buffer.byteLength(rewrittenPlaylist, 'utf-8'),
      undefined,
    )

    writeHeaders(response, status, headers)
    response.end(rewrittenPlaylist)
    return
  }

  writeHeaders(
    response,
    // 直播 FLV/TS 响应使用 200 和分块传输。
    isLiveMedia ? 200 : status,
    createResponseHeaders(
      contentType || inferContentType(responseUrl),
      isLiveMedia ? 0 : getContentLength(upstream.headers),
      isLiveMedia ? undefined : upstream.headers,
    ),
  )
  if (!upstream.body) {
    response.end()
    return
  }
  try {
    await pipeline(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]), response)
  } catch (error) {
    // 下游连接关闭后取消对应的上游媒体请求。
    if (abortController.signal.aborted || response.destroyed) return
    throw error
  }
}

async function proxyDoubanImageRequest(
  response: ServerResponse,
  binding: ProxyBinding,
  onResult: (result: ProxyRequestResult) => void,
): Promise<void> {
  const result = await new Promise<{
    body: Buffer
    contentType: string
    status: number
  }>((resolve, reject) => {
    let settled = false
    const request = net.request({
      method: 'GET',
      url: binding.targetUrl,
      session: binding.context.session,
      redirect: 'follow',
      headers: {
        ...sanitizeMediaHeaders(binding.headers),
        Referer: DOUBAN_IMAGE_REFERER,
      },
      origin: new URL(DOUBAN_IMAGE_REFERER).origin,
      referrerPolicy: 'unsafe-url',
    })
    const timeoutId = setTimeout(() => {
      request.abort()
      finish(() => reject(new Error('豆瓣海报请求超时')))
    }, 12_000)
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      callback()
    }

    request.on('response', (upstream) => {
      const chunks: Buffer[] = []
      let size = 0
      upstream.on('data', (chunk) => {
        size += chunk.byteLength
        if (size > MAX_PROXY_IMAGE_BYTES) {
          request.abort()
          finish(() => reject(new Error('豆瓣海报超过大小限制')))
          return
        }
        chunks.push(chunk)
      })
      upstream.on('error', (error) => finish(() => reject(error)))
      upstream.on('end', () => {
        finish(() =>
          resolve({
            body: Buffer.concat(chunks),
            contentType: getElectronResponseHeader(upstream.headers, 'content-type') ?? 'image/jpeg',
            status: normalizeStatus(upstream.statusCode),
          }),
        )
      })
    })
    request.on('error', (error) => finish(() => reject(error)))
    request.end()
  })

  onResult({
    status: result.status,
    contentType: result.contentType,
    finalUrl: binding.targetUrl,
    isPlaylist: false,
  })
  writeHeaders(response, result.status, createResponseHeaders(result.contentType, result.body.byteLength))
  response.end(result.body)
}

function getElectronResponseHeader(headers: Record<string, string | string[]>, name: string): string | undefined {
  const value = headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

function isDoubanImageUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'doubanio.com' || hostname.endsWith('.doubanio.com')
  } catch {
    return false
  }
}

function getRequestHeaders(
  request: IncomingMessage,
  targetUrl: string,
  configuredHeaders: Record<string, string> = {},
): Record<string, string> {
  const sanitizedHeaders = sanitizeMediaHeaders(configuredHeaders)
  const headers: Record<string, string> = {
    ...sanitizedHeaders,
    'Accept': '*/*',
    // 媒体代理请求不接收压缩响应。
    'Accept-Encoding': 'identity',
  }

  const range = request.headers.range
  // 直播 FLV/TS 请求不转发 Range。
  if (range && !isLiveMediaUrl(targetUrl, '')) {
    headers.Range = range
  }

  return headers
}

function isLiveMediaUrl(url: string, contentType: string): boolean {
  const normalizedContentType = contentType.toLowerCase()
  if (normalizedContentType.includes('video/x-flv') || normalizedContentType.includes('video/flv')) {
    return true
  }
  if (normalizedContentType.includes('video/mp2t') || normalizedContentType.includes('video/mpegts')) {
    return true
  }
  return /\.(?:flv|ts|m2ts)(?:$|[?#])/i.test(url)
}

function createResponseHeaders(
  contentType: string,
  contentLength: number,
  upstreamHeaders?: Headers,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    'Cache-Control': 'no-cache',
    'Content-Type': contentType,
  }

  if (contentLength > 0) {
    headers['Content-Length'] = String(contentLength)
  }

  const acceptRanges = upstreamHeaders?.get('accept-ranges') ?? undefined
  const contentRange = upstreamHeaders?.get('content-range') ?? undefined

  if (acceptRanges) {
    headers['Accept-Ranges'] = acceptRanges
  }

  if (contentRange) {
    headers['Content-Range'] = contentRange
  }

  return headers
}

function writeCorsHeaders(response: ServerResponse): void {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type')
  response.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges')
}

function writeHeaders(response: ServerResponse, status: number, headers: Record<string, string>): void {
  response.writeHead(status, headers)
}

function normalizeStatus(status: number): number {
  return status >= 200 && status <= 599 ? status : 502
}

function getContentLength(headers: Headers): number {
  const value = headers.get('content-length')
  const length = value ? Number(value) : 0
  return Number.isFinite(length) && length > 0 ? length : 0
}

function isPlaylist(url: string, contentType: string): boolean {
  return (
    url.toLowerCase().includes('.m3u8') ||
    PLAYLIST_CONTENT_TYPES.some((type) => contentType.toLowerCase().includes(type))
  )
}

function inferContentType(url: string): string {
  if (/\.m3u8(?:$|[?#])/i.test(url)) {
    return 'application/vnd.apple.mpegurl'
  }

  if (/\.(?:ts|m2ts)(?:$|[?#])/i.test(url)) {
    return 'video/mp2t'
  }

  if (/\.flv(?:$|[?#])/i.test(url)) {
    return 'video/x-flv'
  }

  if (/\.mp4(?:$|[?#])/i.test(url)) {
    return 'video/mp4'
  }

  return 'video/mp2t'
}

function rewritePlaylist(playlist: string, playlistUrl: string, createChildUrl: (targetUrl: string) => string): string {
  return playlist
    .split('\n')
    .map((line) => {
      const trimmedLine = line.trim()

      if (!trimmedLine) {
        return line
      }

      if (trimmedLine.startsWith('#')) {
        return rewritePlaylistTagUri(line, playlistUrl, createChildUrl)
      }

      return createChildUrl(new URL(trimmedLine, playlistUrl).toString())
    })
    .join('\n')
}

function rewritePlaylistTagUri(
  line: string,
  playlistUrl: string,
  createChildUrl: (targetUrl: string) => string,
): string {
  return line.replace(/URI="([^"]+)"/g, (_match, rawUri: string) => {
    return `URI="${createChildUrl(new URL(rawUri, playlistUrl).toString())}"`
  })
}

const BLOCKED_MEDIA_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'range'])

function sanitizeMediaHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.trim().toLowerCase()
    if (!normalized || BLOCKED_MEDIA_HEADERS.has(normalized) || !value) continue
    result[name.trim()] = value
  }
  return result
}
