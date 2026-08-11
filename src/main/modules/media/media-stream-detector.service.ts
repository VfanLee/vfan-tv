import { fileTypeFromBuffer } from 'file-type'
import type { MediaStreamDetectionInput, MediaStreamDetectionResult, MediaStreamType } from '@shared/types'
import type { ContentNetworkContext, ContentNetworkService } from '../../infrastructure/network/content-network.service'

const PROBE_TIMEOUT_MS = 8_000
const MAX_PROBE_ATTEMPTS = 2
const MAX_PROBE_BYTES = 64 * 1024
const MPEG_TS_PACKET_SIZE = 188

/** 根据媒体响应和 URL 识别流类型及不可播放响应 */
export async function detectMediaStreamType(
  input: MediaStreamDetectionInput,
  network: ContentNetworkService,
  context: ContentNetworkContext,
): Promise<MediaStreamDetectionResult> {
  let targetUrl: URL
  try {
    targetUrl = new URL(input.url)
  } catch {
    return { type: 'native', uncertain: true, errorMessage: '播放地址无效' }
  }
  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    return { type: 'native', uncertain: true, errorMessage: '仅支持 HTTP 或 HTTPS 播放地址' }
  }

  for (let attempt = 1; attempt <= MAX_PROBE_ATTEMPTS; attempt += 1) {
    try {
      return await probeOnce(targetUrl.toString(), input, network, context)
    } catch (error) {
      if (attempt >= MAX_PROBE_ATTEMPTS) {
        if (error instanceof MediaProbeHttpError) {
          return {
            type: detectKnownMediaStreamTypeFromUrl(targetUrl.toString()) ?? 'native',
            uncertain: true,
            statusCode: error.status,
            contentType: error.contentType,
            finalUrl: error.finalUrl,
            errorMessage: getHttpProbeErrorMessage(error.status),
          }
        }
        return {
          type: 'native',
          uncertain: true,
          errorMessage: getNetworkProbeErrorMessage(error),
        }
      }
    }
  }
  return { type: 'native', uncertain: true, errorMessage: '无法确认播放资源类型' }
}

async function probeOnce(
  url: string,
  input: MediaStreamDetectionInput,
  network: ContentNetworkService,
  context: ContentNetworkContext,
): Promise<MediaStreamDetectionResult> {
  const configuredHeaders = input.headers ?? {}
  const response = await network.fetchWithRedirects(
    url,
    {
      headers: {
        ...configuredHeaders,
        Accept: 'application/vnd.apple.mpegurl, application/x-mpegurl, video/x-flv, video/mp2t, */*',
        Range: `bytes=0-${MAX_PROBE_BYTES - 1}`,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    },
    context,
    url,
  )
  if (!response.ok) {
    const contentType = response.headers.get('content-type') ?? undefined
    const finalUrl = response.url || url
    await response.body?.cancel().catch(() => undefined)
    throw new MediaProbeHttpError(response.status, contentType, finalUrl)
  }

  const contentType = response.headers.get('content-type') ?? undefined
  const responseMetadata = {
    statusCode: response.status,
    contentType,
    finalUrl: response.url || url,
  }
  const typeFromContentType = detectStreamTypeFromContentType(contentType)
  if (typeFromContentType !== undefined) {
    await response.body?.cancel().catch(() => undefined)
    return { type: typeFromContentType, ...responseMetadata }
  }

  const body = await readResponsePrefix(response, MAX_PROBE_BYTES)
  const typeFromBody = await detectStreamTypeFromBody(body)
  if (typeFromBody !== undefined) return { type: typeFromBody, ...responseMetadata }
  const normalizedContentType = contentType?.toLowerCase() ?? ''
  if (normalizedContentType.includes('html') || normalizedContentType.includes('json') || isClearlyNonMediaBody(body)) {
    return {
      type: 'native',
      uncertain: true,
      ...responseMetadata,
      errorMessage: '上游返回的不是可播放媒体内容',
    }
  }
  const typeFromFinalUrl = detectKnownMediaStreamTypeFromUrl(response.url)
  if (typeFromFinalUrl) return { type: typeFromFinalUrl, ...responseMetadata }
  return {
    type: 'native',
    uncertain: true,
    ...responseMetadata,
    errorMessage: '无法识别上游媒体格式',
  }
}

class MediaProbeHttpError extends Error {
  constructor(
    readonly status: number,
    readonly contentType?: string,
    readonly finalUrl?: string,
  ) {
    super(`HTTP ${status}`)
    this.name = 'MediaProbeHttpError'
  }
}

function getHttpProbeErrorMessage(status: number): string {
  if (status === 401 || status === 403) return `上游拒绝访问（HTTP ${status}）`
  if (status === 404 || status === 410) return `播放资源不存在（HTTP ${status}）`
  if (status === 429) return '上游请求过于频繁（HTTP 429）'
  return `上游返回 HTTP ${status}`
}

function getNetworkProbeErrorMessage(error: unknown): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return '播放资源探测超时'
  }
  return '无法连接播放资源'
}

function isClearlyNonMediaBody(body: Uint8Array): boolean {
  const prefix = new TextDecoder()
    .decode(body.subarray(0, Math.min(body.length, 256)))
    .trimStart()
    .toLowerCase()
  return (
    prefix.startsWith('<!doctype html') ||
    prefix.startsWith('<html') ||
    prefix.startsWith('<?xml') ||
    prefix.startsWith('{') ||
    prefix.startsWith('[')
  )
}

/** 根据 URL 文件扩展名推断媒体类型 */
export function detectKnownMediaStreamTypeFromUrl(url: string): MediaStreamType | undefined {
  let pathname: string
  try {
    pathname = new URL(url).pathname.toLowerCase()
  } catch {
    return undefined
  }
  if (pathname.endsWith('.m3u8')) return 'hls'
  if (pathname.endsWith('.flv')) return 'flv'
  if (pathname.endsWith('.ts') || pathname.endsWith('.m2ts')) return 'mpegts'
  if (/\.(?:mp4|m4v|mov|webm|ogv|ogg|mkv)$/.test(pathname)) return 'native'
  return undefined
}

function detectStreamTypeFromContentType(contentType: string | undefined): MediaStreamType | undefined {
  const normalized = contentType?.toLowerCase() ?? ''
  if (normalized.includes('mpegurl') || normalized.includes('vnd.apple.mpegurl')) return 'hls'
  if (normalized.includes('video/x-flv') || normalized.includes('video/flv')) return 'flv'
  if (normalized.includes('video/mp2t') || normalized.includes('video/mpegts')) return 'mpegts'
  if (normalized.startsWith('video/')) return 'native'
  return undefined
}

async function detectStreamTypeFromBody(body: Uint8Array): Promise<MediaStreamType | undefined> {
  const textPrefix = new TextDecoder().decode(body.subarray(0, Math.min(body.length, 256))).trimStart()
  if (textPrefix.startsWith('#EXTM3U')) return 'hls'
  const fileType = await fileTypeFromBuffer(body)
  const typeFromFileType = mapFileTypeToStreamType(fileType?.ext, fileType?.mime)
  if (typeFromFileType) return typeFromFileType
  if (isMpegTransportStream(body)) return 'mpegts'
  return undefined
}

function mapFileTypeToStreamType(ext: string | undefined, mime: string | undefined): MediaStreamType | undefined {
  const normalizedExt = ext?.toLowerCase() ?? ''
  const normalizedMime = mime?.toLowerCase() ?? ''
  if (normalizedExt === 'flv' || normalizedMime.includes('video/x-flv') || normalizedMime.includes('video/flv')) {
    return 'flv'
  }
  if (
    ['mts', 'm2ts', 'ts'].includes(normalizedExt) ||
    normalizedMime.includes('video/mp2t') ||
    normalizedMime.includes('video/mpegts')
  ) {
    return 'mpegts'
  }
  if (
    ['mp4', 'm4v', 'mov', 'webm', 'ogv', 'ogg', 'mkv'].includes(normalizedExt) ||
    normalizedMime.startsWith('video/')
  ) {
    return 'native'
  }
  return undefined
}

function isMpegTransportStream(body: Uint8Array): boolean {
  if (body.length < MPEG_TS_PACKET_SIZE * 3) return false
  for (let offset = 0; offset < Math.min(MPEG_TS_PACKET_SIZE, body.length); offset += 1) {
    if (
      body[offset] === 0x47 &&
      body[offset + MPEG_TS_PACKET_SIZE] === 0x47 &&
      body[offset + MPEG_TS_PACKET_SIZE * 2] === 0x47
    ) {
      return true
    }
  }
  return false
}

async function readResponsePrefix(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      const remaining = maxBytes - total
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value
      chunks.push(chunk)
      total += chunk.byteLength
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}
