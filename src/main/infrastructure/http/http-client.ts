import { Buffer } from 'buffer'
import { randomUUID } from 'crypto'
import type { ContentNetworkRoute, ContentNetworkService } from '../network/content-network.service'

type HttpNetworkRoute = Exclude<ContentNetworkRoute, 'playback' | 'update'>

export interface HttpRequestOptions {
  headers?: Record<string, string | number | boolean | undefined>
  maxContentLength?: number
  responseType?: 'arraybuffer' | 'json' | 'text'
  requestLabel?: string
  signal?: AbortSignal
  timeout?: number
}

export class HttpRequestError extends Error {
  readonly code: string
  readonly status?: number

  constructor(message: string, code: string, status?: number) {
    super(message)
    this.name = 'HttpRequestError'
    this.code = code
    this.status = status
  }
}

export class HttpClient {
  constructor(
    private readonly network: ContentNetworkService,
    private readonly route: HttpNetworkRoute,
  ) {}

  async get<T>(url: string, options: HttpRequestOptions = {}): Promise<T> {
    const requestId = randomUUID()
    const startedAt = Date.now()
    const requestLabel = sanitizeLogLabel(options.requestLabel ?? '普通内容')
    const target = getSafeHost(url)
    const network = this.network.getRouteDescription(this.route)
    console.info(`[${requestLabel}] 开始 | requestId=${requestId} | 网络=${network} | 目标=${target}`)
    const signal = combineSignals(options.signal, options.timeout)
    let response: Response
    try {
      response = await this.network.withContext(this.route, (context) =>
        this.network.fetchWithRedirects(
          url,
          {
            method: 'GET',
            redirect: 'follow',
            headers: normalizeHeaders(options.headers),
            signal,
          },
          context,
          url,
        ),
      )
    } catch {
      const reason = signal.aborted ? (options.signal?.aborted ? '请求已取消' : '请求超时') : '网络请求失败'
      console.warn(
        `[${requestLabel}] 失败 | requestId=${requestId} | 网络=${network} | 目标=${target} | 状态码=— | Content-Type=— | 原因=${reason} | 耗时=${Date.now() - startedAt}ms`,
      )
      if (signal.aborted) {
        const cancelled = options.signal?.aborted
        throw new HttpRequestError(cancelled ? '请求已取消' : '请求超时', cancelled ? 'ERR_CANCELED' : 'ECONNABORTED')
      }
      throw new HttpRequestError('网络请求失败', 'ERR_NETWORK')
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      console.warn(
        `[${requestLabel}] 失败 | requestId=${requestId} | 网络=${network} | 目标=${target} | 状态码=${response.status} | Content-Type=${sanitizeContentType(response.headers.get('content-type'))} | 原因=上游返回 HTTP ${response.status} | 耗时=${Date.now() - startedAt}ms`,
      )
      throw new HttpRequestError(`HTTP ${response.status}`, 'ERR_BAD_RESPONSE', response.status)
    }

    const data = Buffer.from(await response.arrayBuffer())
    if (options.maxContentLength !== undefined && data.byteLength > options.maxContentLength) {
      console.warn(
        `[${requestLabel}] 失败 | requestId=${requestId} | 网络=${network} | 目标=${target} | 状态码=${response.status} | Content-Type=${sanitizeContentType(response.headers.get('content-type'))} | 原因=响应内容超过大小限制 | 耗时=${Date.now() - startedAt}ms`,
      )
      throw new HttpRequestError('响应内容超过大小限制', 'ERR_CONTENT_LENGTH')
    }
    logSuccess(requestLabel, requestId, network, target, response, startedAt)
    if (options.responseType === 'arraybuffer') return data as T
    const text = data.toString('utf8')
    if (options.responseType === 'text') return text as T
    if (options.responseType === 'json' || looksLikeJson(text, response.headers.get('content-type'))) {
      try {
        return JSON.parse(text) as T
      } catch {
        if (options.responseType === 'json') throw new HttpRequestError('响应不是有效的 JSON', 'ERR_BAD_RESPONSE')
      }
    }
    return text as T
  }
}

function logSuccess(
  label: string,
  requestId: string,
  network: string,
  target: string,
  response: Response,
  startedAt: number,
): void {
  console.info(
    `[${label}] 成功 | requestId=${requestId} | 网络=${network} | 目标=${target} | 状态码=${response.status} | Content-Type=${sanitizeContentType(response.headers.get('content-type'))} | 耗时=${Date.now() - startedAt}ms`,
  )
}

function getSafeHost(value: string): string {
  try {
    return new URL(value).host
  } catch {
    return '无效地址'
  }
}

function sanitizeContentType(value: string | null): string {
  return value?.split(';', 1)[0].trim().slice(0, 80) || '未提供'
}

function sanitizeLogLabel(value: string): string {
  return (
    value.replace(/\s+/g, ' ').replaceAll('|', ' ').replaceAll('[', ' ').replaceAll(']', ' ').trim().slice(0, 32) ||
    '普通内容'
  )
}

export function isHttpRequestError(error: unknown): error is HttpRequestError {
  return error instanceof HttpRequestError
}

function normalizeHeaders(headers: HttpRequestOptions['headers']): HeadersInit | undefined {
  if (!headers) return undefined
  return Object.fromEntries(
    Object.entries(headers).flatMap(([name, value]) =>
      typeof value === 'string' || typeof value === 'number' ? [[name, String(value)]] : [],
    ),
  )
}

function combineSignals(signal: AbortSignal | undefined, timeout: number | undefined): AbortSignal {
  const values = [signal, timeout && timeout > 0 ? AbortSignal.timeout(timeout) : undefined].filter(
    (value): value is AbortSignal => Boolean(value),
  )
  if (values.length === 0) return new AbortController().signal
  if (values.length === 1) return values[0]
  return AbortSignal.any(values)
}

function looksLikeJson(text: string, contentType: string | null): boolean {
  if (contentType?.toLowerCase().includes('json')) return true
  const trimmed = text.trimStart()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}
