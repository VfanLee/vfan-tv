import type { MediaProbeInput, MediaProbeResult, VodSourceConfig } from '@shared/types'
import type { ContentNetworkService } from '../../infrastructure/network/content-network.service'
import { resolveSourceRequestHeaders } from '../../infrastructure/http/source-request-headers'

const PROBE_TIMEOUT_MS = 5_000
const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024

/** 探测媒体地址的可达性、响应延迟和 HLS 最高画质 */
export async function probeMediaSource(
  input: MediaProbeInput,
  network: ContentNetworkService,
  source?: VodSourceConfig,
): Promise<MediaProbeResult> {
  return network.withVodPlaybackContext(async (context) => {
    const startedAt = performance.now()
    try {
      const targetUrl = new URL(input.url)
      if (!['http:', 'https:'].includes(targetUrl.protocol)) return { latencyMs: null, quality: null }
      const response = await network.fetchWithRedirects(
        targetUrl.toString(),
        {
          headers: {
            Accept: 'application/vnd.apple.mpegurl, application/x-mpegurl, */*',
            ...(source ? resolveSourceRequestHeaders(source.url, targetUrl.toString(), source.headers) : {}),
          },
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        },
        context,
        targetUrl.toString(),
      )
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        return { latencyMs: null, quality: null }
      }
      const body = await readResponsePrefix(response, MAX_PLAYLIST_BYTES)
      return {
        latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
        quality: getHighestPlaylistQuality(new TextDecoder().decode(body)),
      }
    } catch {
      return { latencyMs: null, quality: null }
    }
  })
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
  return joinChunks(chunks, total)
}

function joinChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function getHighestPlaylistQuality(playlist: string): string | null {
  const heights = Array.from(playlist.matchAll(/RESOLUTION=\d+x(\d+)/gi), (match) => Number(match[1])).filter(
    (height) => Number.isFinite(height) && height > 0,
  )
  return heights.length > 0 ? `${Math.max(...heights)}P` : null
}
