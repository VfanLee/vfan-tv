import axios, { type AxiosResponseHeaders, type RawAxiosResponseHeaders } from 'axios'
import { protocol } from 'electron'
import { createMediaProxyUrl } from './media-proxy-url'

const PLAYLIST_CONTENT_TYPES = ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl']

export function registerMediaProxyProtocol(): void {
  protocol.handle('vfan-media', async (request) => {
    const proxyUrl = new URL(request.url)
    const targetUrl = proxyUrl.searchParams.get('url')

    if (!targetUrl) {
      return new Response('Missing media url', { status: 400 })
    }

    const referer = proxyUrl.searchParams.get('referer') ?? undefined
    const headers = getHeaders(proxyUrl.searchParams.get('headers'), referer)

    try {
      const upstream = await axios.get<ArrayBuffer>(targetUrl, {
        headers,
        responseType: 'arraybuffer',
        timeout: 15_000,
        validateStatus: () => true,
      })

      const body = Buffer.from(upstream.data)
      const contentType = getResponseHeader(upstream.headers, 'content-type') ?? ''
      const status = normalizeStatus(upstream.status)

      if (isPlaylist(targetUrl, contentType)) {
        const rewrittenPlaylist = rewritePlaylist(body.toString('utf-8'), targetUrl, referer, headers)

        return new Response(rewrittenPlaylist, {
          status,
          headers: createResponseHeaders(contentType || 'application/vnd.apple.mpegurl', Buffer.byteLength(rewrittenPlaylist, 'utf-8')),
        })
      }

      return new Response(new Uint8Array(body), {
        status,
        headers: createResponseHeaders(contentType || 'application/octet-stream', body.length),
      })
    } catch (error) {
      console.error('Media proxy fetch failed:', targetUrl, error)
      return new Response('Failed to fetch media resource', { status: 502 })
    }
  })
}

function createResponseHeaders(contentType: string, contentLength: number): Headers {
  const headers = new Headers()
  headers.set('Content-Type', contentType)
  headers.set('Content-Length', String(contentLength))
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Cache-Control', 'public, max-age=86400')
  return headers
}

function normalizeStatus(status: number): number {
  return status >= 200 && status <= 599 ? status : 502
}

function getResponseHeader(
  headers: RawAxiosResponseHeaders | AxiosResponseHeaders,
  name: string,
): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()]

  if (value === undefined) {
    return undefined
  }

  return Array.isArray(value) ? value.join(', ') : String(value)
}

function getHeaders(rawHeaders: string | null, referer: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    Accept: '*/*',
  }

  if (referer) {
    headers.Referer = referer

    if (referer.includes('douban.com')) {
      headers.Origin = 'https://movie.douban.com'
    }
  }

  if (!rawHeaders) {
    return headers
  }

  try {
    const parsed = JSON.parse(rawHeaders) as unknown

    if (typeof parsed === 'object' && parsed !== null) {
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string') {
          headers[key] = value
        }
      }
    }
  } catch {
    return headers
  }

  return headers
}

function isPlaylist(url: string, contentType: string): boolean {
  return (
    url.toLowerCase().includes('.m3u8') ||
    PLAYLIST_CONTENT_TYPES.some((type) => contentType.toLowerCase().includes(type))
  )
}

function rewritePlaylist(
  playlist: string,
  playlistUrl: string,
  referer: string | undefined,
  headers: Record<string, string>,
): string {
  return playlist
    .split('\n')
    .map((line) => {
      const trimmedLine = line.trim()

      if (!trimmedLine) {
        return line
      }

      if (trimmedLine.startsWith('#')) {
        return rewritePlaylistTagUri(line, playlistUrl, referer, headers)
      }

      const segmentUrl = new URL(trimmedLine, playlistUrl).toString()
      return createMediaProxyUrl({
        url: segmentUrl,
        referer,
        headers,
      })
    })
    .join('\n')
}

function rewritePlaylistTagUri(
  line: string,
  playlistUrl: string,
  referer: string | undefined,
  headers: Record<string, string>,
): string {
  return line.replace(/URI="([^"]+)"/g, (_match, rawUri: string) => {
    const keyUrl = new URL(rawUri, playlistUrl).toString()
    const proxiedKeyUrl = createMediaProxyUrl({
      url: keyUrl,
      referer,
      headers,
    })

    return `URI="${proxiedKeyUrl}"`
  })
}
