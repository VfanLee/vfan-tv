import axios from 'axios'
import { fileTypeFromBuffer } from 'file-type'
import { Readable } from 'stream'
import type { MediaStreamDetectionInput, MediaStreamDetectionResult, MediaStreamType } from '@shared/types'

// 部分源（如经跳转解析到 CDN 签名地址的直播源）首次跳转解析耗时可达数秒，
// 因此探测超时需要留出足够余量，避免把「解析慢」误判为「原生直链」。
const PROBE_TIMEOUT_MS = 8_000
const MAX_PROBE_ATTEMPTS = 2
const MAX_PROBE_BYTES = 64 * 1024
const MPEG_TS_PACKET_SIZE = 188
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

export async function detectMediaStreamType(input: MediaStreamDetectionInput): Promise<MediaStreamDetectionResult> {
  let targetUrl: URL
  try {
    targetUrl = new URL(input.url)
  } catch {
    return { type: 'native' }
  }

  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    return { type: 'native' }
  }

  for (let attempt = 1; attempt <= MAX_PROBE_ATTEMPTS; attempt += 1) {
    try {
      return await probeOnce(targetUrl.toString(), input)
    } catch {
      if (attempt >= MAX_PROBE_ATTEMPTS) {
        // 探测多次仍失败（超时/网络错误），无法确认真实类型，标记为不确定，
        // 以便调用方避免永久缓存该错误判断。
        return { type: 'native', uncertain: true }
      }
    }
  }

  return { type: 'native', uncertain: true }
}

async function probeOnce(url: string, input: MediaStreamDetectionInput): Promise<MediaStreamDetectionResult> {
  const response = await axios.get<Readable>(url, {
    headers: {
      'User-Agent': input.userAgent || DEFAULT_USER_AGENT,
      'Accept': 'application/vnd.apple.mpegurl, application/x-mpegurl, video/x-flv, video/mp2t, */*',
      'Range': `bytes=0-${MAX_PROBE_BYTES - 1}`,
      ...(input.referer ? { Referer: input.referer } : {}),
    },
    maxRedirects: 5,
    proxy: false,
    // FLV/TS 直播是持续推流，不能用 arraybuffer 等整包结束；只读前缀后主动断开。
    responseType: 'stream',
    timeout: PROBE_TIMEOUT_MS,
    validateStatus: () => true,
  })

  const responseUrl = getResponseUrl(response.request)
  const contentType =
    typeof response.headers['content-type'] === 'string' ? response.headers['content-type'] : undefined
  const typeFromUrl = detectStreamTypeFromUrl(responseUrl)
  if (typeFromUrl) {
    destroyStream(response.data)
    return { type: typeFromUrl }
  }

  const typeFromContentType = detectStreamTypeFromContentType(contentType)
  if (typeFromContentType) {
    destroyStream(response.data)
    return { type: typeFromContentType }
  }

  const body = await readStreamPrefix(response.data, MAX_PROBE_BYTES)
  return {
    type: await detectStreamTypeFromBody(body),
  }
}

function detectStreamTypeFromUrl(responseUrl?: string): Exclude<MediaStreamType, 'native'> | undefined {
  if (!responseUrl) return undefined
  if (/\.m3u8(?:$|[?#])/i.test(responseUrl)) return 'hls'
  if (/\.flv(?:$|[?#])/i.test(responseUrl)) return 'flv'
  if (/\.(?:ts|m2ts)(?:$|[?#])/i.test(responseUrl)) return 'mpegts'
  return undefined
}

function detectStreamTypeFromContentType(
  contentType: string | undefined,
): Exclude<MediaStreamType, 'native'> | undefined {
  const normalizedContentType = contentType?.toLowerCase() ?? ''
  if (normalizedContentType.includes('mpegurl') || normalizedContentType.includes('vnd.apple.mpegurl')) {
    return 'hls'
  }
  if (normalizedContentType.includes('video/x-flv') || normalizedContentType.includes('video/flv')) {
    return 'flv'
  }
  if (normalizedContentType.includes('video/mp2t') || normalizedContentType.includes('video/mpegts')) {
    return 'mpegts'
  }
  return undefined
}

async function detectStreamTypeFromBody(body: Uint8Array): Promise<MediaStreamType> {
  // file-type 只识别二进制容器；m3u8 是文本清单，需单独判断。
  const textPrefix = new TextDecoder().decode(body.subarray(0, Math.min(body.length, 256))).trimStart()
  if (textPrefix.startsWith('#EXTM3U')) return 'hls'

  const fileType = await fileTypeFromBuffer(body)
  const typeFromFileType = mapFileTypeToStreamType(fileType?.ext, fileType?.mime)
  if (typeFromFileType) return typeFromFileType

  // file-type 要求 TS 同步字节对齐到偏移 0；部分源前缀可能有填充，保留扫描兜底。
  if (isMpegTransportStream(body)) return 'mpegts'
  return 'native'
}

function mapFileTypeToStreamType(
  ext: string | undefined,
  mime: string | undefined,
): Exclude<MediaStreamType, 'native' | 'hls'> | undefined {
  const normalizedExt = ext?.toLowerCase() ?? ''
  const normalizedMime = mime?.toLowerCase() ?? ''

  if (normalizedExt === 'flv' || normalizedMime.includes('video/x-flv') || normalizedMime.includes('video/flv')) {
    return 'flv'
  }
  if (
    normalizedExt === 'mts' ||
    normalizedExt === 'm2ts' ||
    normalizedExt === 'ts' ||
    normalizedMime.includes('video/mp2t') ||
    normalizedMime.includes('video/mpegts')
  ) {
    return 'mpegts'
  }

  return undefined
}

function getResponseUrl(request: unknown): string | undefined {
  if (!request || typeof request !== 'object') return undefined
  const responseUrl =
    (request as { res?: { responseUrl?: unknown }; responseURL?: unknown }).res?.responseUrl ??
    (request as { responseURL?: unknown }).responseURL
  return typeof responseUrl === 'string' && responseUrl ? responseUrl : undefined
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

async function readStreamPrefix(stream: Readable, maxBytes: number): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  let total = 0

  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      chunks.push(buffer)
      total += buffer.length
      if (total >= maxBytes) {
        break
      }
    }
  } finally {
    destroyStream(stream)
  }

  return new Uint8Array(Buffer.concat(chunks, Math.min(total, maxBytes)).subarray(0, maxBytes))
}

function destroyStream(stream: Readable): void {
  stream.destroy()
}
