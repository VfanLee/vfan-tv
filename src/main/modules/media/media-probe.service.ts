import axios from 'axios'
import type { MediaProbeInput, MediaProbeResult } from '@shared/types'

const PROBE_TIMEOUT_MS = 5_000
const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024

// 使用轻量请求估算媒体可达性与响应延迟，不读取完整媒体内容。
export async function probeMediaSource(input: MediaProbeInput): Promise<MediaProbeResult> {
  const startedAt = performance.now()

  try {
    const targetUrl = new URL(input.url)
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      return { latencyMs: null, quality: null }
    }

    const response = await axios.get<string>(targetUrl.toString(), {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept': 'application/vnd.apple.mpegurl, application/x-mpegurl, */*',
        ...(input.referer ? { Referer: input.referer } : {}),
      },
      maxContentLength: MAX_PLAYLIST_BYTES,
      responseType: 'text',
      timeout: PROBE_TIMEOUT_MS,
    })

    return {
      latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
      quality: getHighestPlaylistQuality(response.data),
    }
  } catch {
    return { latencyMs: null, quality: null }
  }
}

function getHighestPlaylistQuality(playlist: string): string | null {
  const heights = Array.from(playlist.matchAll(/RESOLUTION=\d+x(\d+)/gi), (match) => Number(match[1])).filter(
    (height) => Number.isFinite(height) && height > 0,
  )

  return heights.length > 0 ? `${Math.max(...heights)}P` : null
}
