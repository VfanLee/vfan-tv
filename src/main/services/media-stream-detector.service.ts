import axios from 'axios'
import type { MediaStreamDetectionInput, MediaStreamDetectionResult, MediaStreamType } from '@shared/types'

const PROBE_TIMEOUT_MS = 3_000
const MAX_PROBE_BYTES = 64 * 1024
const MPEG_TS_PACKET_SIZE = 188

export async function detectMediaStreamType(input: MediaStreamDetectionInput): Promise<MediaStreamDetectionResult> {
  try {
    const targetUrl = new URL(input.url)
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      return { type: 'native' }
    }

    const response = await axios.get<ArrayBuffer>(targetUrl.toString(), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept': 'application/vnd.apple.mpegurl, application/x-mpegurl, video/x-flv, video/mp2t, */*',
        'Range': `bytes=0-${MAX_PROBE_BYTES - 1}`,
        ...(input.referer ? { Referer: input.referer } : {}),
      },
      maxContentLength: MAX_PROBE_BYTES,
      maxRedirects: 3,
      responseType: 'arraybuffer',
      timeout: PROBE_TIMEOUT_MS,
      validateStatus: () => true,
    })

    const contentType = response.headers['content-type']
    return {
      type: detectStreamType(typeof contentType === 'string' ? contentType : undefined, new Uint8Array(response.data)),
    }
  } catch {
    return { type: 'native' }
  }
}

function detectStreamType(contentType: string | undefined, body: Uint8Array): MediaStreamType {
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

  const textPrefix = new TextDecoder().decode(body.subarray(0, Math.min(body.length, 256))).trimStart()
  if (textPrefix.startsWith('#EXTM3U')) return 'hls'
  if (body[0] === 0x46 && body[1] === 0x4c && body[2] === 0x56) return 'flv'
  if (isMpegTransportStream(body)) return 'mpegts'
  return 'native'
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
