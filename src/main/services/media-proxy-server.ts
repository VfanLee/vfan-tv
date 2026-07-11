import axios, { type AxiosResponseHeaders, type RawAxiosResponseHeaders } from 'axios'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { Readable } from 'stream'

const PLAYLIST_CONTENT_TYPES = ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl']

export class MediaProxyServer {
  private server?: Server
  private baseUrl?: string
  private startPromise?: Promise<string>

  getBaseUrl(): Promise<string> {
    if (this.baseUrl) {
      return Promise.resolve(this.baseUrl)
    }

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
    if (request.method === 'OPTIONS') {
      writeCorsHeaders(response)
      response.writeHead(204)
      response.end()
      return
    }

    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (!['/media', '/image'].includes(requestUrl.pathname)) {
      response.writeHead(404)
      response.end('Not found')
      return
    }

    const targetUrl = requestUrl.searchParams.get('url')
    if (!targetUrl) {
      response.writeHead(400)
      response.end('Missing media url')
      return
    }

    try {
      const parsedTargetUrl = new URL(targetUrl)
      if (!['http:', 'https:'].includes(parsedTargetUrl.protocol)) {
        response.writeHead(400)
        response.end('Only http/https media resources are supported')
        return
      }

      await proxyMediaRequest(
        request,
        response,
        parsedTargetUrl.toString(),
        this.baseUrl ?? '',
        requestUrl.searchParams.get('referer') ?? `${parsedTargetUrl.origin}/`,
        requestUrl.searchParams.get('user-agent') ?? undefined,
      )
    } catch (error) {
      console.error('Live media proxy failed:', targetUrl, error)
      if (!response.headersSent) {
        writeCorsHeaders(response)
        response.writeHead(502)
      }
      response.end('Failed to fetch media resource')
    }
  }
}

async function proxyMediaRequest(
  request: IncomingMessage,
  response: ServerResponse,
  targetUrl: string,
  baseUrl: string,
  referer: string | undefined,
  userAgent: string | undefined,
): Promise<void> {
  const abortController = new AbortController()
  response.once('close', () => abortController.abort())

  const upstream = await axios.get<Readable>(targetUrl, {
    headers: getRequestHeaders(request, referer, userAgent),
    proxy: false,
    responseType: 'stream',
    signal: abortController.signal,
    timeout: 30_000,
    validateStatus: () => true,
  })

  const contentType = getResponseHeader(upstream.headers, 'content-type') ?? ''
  const status = normalizeStatus(upstream.status)
  const responseUrl = getResponseUrl(upstream.request) ?? targetUrl

  if (isPlaylist(responseUrl, contentType)) {
    const body = await readStream(upstream.data)
    const rewrittenPlaylist = rewritePlaylist(body.toString('utf-8'), responseUrl, baseUrl, referer, userAgent)
    const headers = createResponseHeaders(
      contentType || 'application/vnd.apple.mpegurl',
      Buffer.byteLength(rewrittenPlaylist, 'utf-8'),
      undefined,
      responseUrl,
    )

    writeHeaders(response, status, headers)
    response.end(rewrittenPlaylist)
    return
  }

  writeHeaders(
    response,
    status,
    createResponseHeaders(
      contentType || inferContentType(responseUrl),
      getContentLength(upstream.headers),
      upstream.headers,
      responseUrl,
    ),
  )
  upstream.data.pipe(response)
}

function getRequestHeaders(
  request: IncomingMessage,
  referer: string | undefined,
  userAgent: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent':
      userAgent ||
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    'Accept': '*/*',
  }

  const range = request.headers.range
  if (range) {
    headers.Range = range
  }

  if (referer) {
    headers.Referer = referer
  }

  return headers
}

function createResponseHeaders(
  contentType: string,
  contentLength: number,
  upstreamHeaders?: RawAxiosResponseHeaders | AxiosResponseHeaders,
  resolvedUrl?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, X-Vfan-Resolved-Url',
    'Cache-Control': 'no-cache',
    'Content-Type': contentType,
  }

  if (resolvedUrl) {
    headers['X-Vfan-Resolved-Url'] = encodeURIComponent(resolvedUrl)
  }

  if (contentLength > 0) {
    headers['Content-Length'] = String(contentLength)
  }

  const acceptRanges = upstreamHeaders ? getResponseHeader(upstreamHeaders, 'accept-ranges') : undefined
  const contentRange = upstreamHeaders ? getResponseHeader(upstreamHeaders, 'content-range') : undefined

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
  response.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Length, Content-Range, Accept-Ranges, X-Vfan-Resolved-Url',
  )
}

function writeHeaders(response: ServerResponse, status: number, headers: Record<string, string>): void {
  response.writeHead(status, headers)
}

function normalizeStatus(status: number): number {
  return status >= 200 && status <= 599 ? status : 502
}

function getResponseHeader(headers: RawAxiosResponseHeaders | AxiosResponseHeaders, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()]

  if (value === undefined) {
    return undefined
  }

  return Array.isArray(value) ? value.join(', ') : String(value)
}

function getContentLength(headers: RawAxiosResponseHeaders | AxiosResponseHeaders): number {
  const value = getResponseHeader(headers, 'content-length')
  const length = value ? Number(value) : 0
  return Number.isFinite(length) && length > 0 ? length : 0
}

function getResponseUrl(request: unknown): string | undefined {
  if (!request || typeof request !== 'object') {
    return undefined
  }

  const maybeRequest = request as { res?: { responseUrl?: unknown }; responseURL?: unknown }
  const responseUrl = maybeRequest.res?.responseUrl ?? maybeRequest.responseURL

  return typeof responseUrl === 'string' && responseUrl ? responseUrl : undefined
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

async function readStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return Buffer.concat(chunks)
}

function rewritePlaylist(
  playlist: string,
  playlistUrl: string,
  baseUrl: string,
  referer: string | undefined,
  userAgent: string | undefined,
): string {
  return playlist
    .split('\n')
    .map((line) => {
      const trimmedLine = line.trim()

      if (!trimmedLine) {
        return line
      }

      if (trimmedLine.startsWith('#')) {
        return rewritePlaylistTagUri(line, playlistUrl, baseUrl, referer, userAgent)
      }

      return createProxyUrl(baseUrl, new URL(trimmedLine, playlistUrl).toString(), referer, userAgent)
    })
    .join('\n')
}

function rewritePlaylistTagUri(
  line: string,
  playlistUrl: string,
  baseUrl: string,
  referer: string | undefined,
  userAgent: string | undefined,
): string {
  return line.replace(/URI="([^"]+)"/g, (_match, rawUri: string) => {
    return `URI="${createProxyUrl(baseUrl, new URL(rawUri, playlistUrl).toString(), referer, userAgent)}"`
  })
}

function createProxyUrl(
  baseUrl: string,
  targetUrl: string,
  referer: string | undefined,
  userAgent: string | undefined,
): string {
  const proxyUrl = new URL('/media', baseUrl)
  proxyUrl.searchParams.set('url', targetUrl)
  if (referer) {
    proxyUrl.searchParams.set('referer', referer)
  }
  if (userAgent) {
    proxyUrl.searchParams.set('user-agent', userAgent)
  }
  return proxyUrl.toString()
}
