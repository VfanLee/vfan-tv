import type {
  HotRecommendationType,
  HotRecommendationsPage,
  HotRecommendationsRequest,
  RecommendationItem,
} from '@shared/types'
import { randomUUID } from 'crypto'
import { net, type Session } from 'electron'
import { clamp } from 'es-toolkit/math'
import { omitBy } from 'es-toolkit/object'
import type { ContentNetworkContext, ContentNetworkService } from '../../infrastructure/network/content-network.service'

const DOUBAN_MOVIE_REFERER = 'https://movie.douban.com/explore'
const DOUBAN_TV_REFERER = 'https://movie.douban.com/tv/'

interface DoubanRecentHotResponse {
  items?: unknown[]
}

interface DoubanHotRequest {
  category: RecommendationItem['category']
  path: 'movie' | 'tv'
  categoryParam: string
  defaultType: HotRecommendationType
  supportedTypes: readonly HotRecommendationType[]
  referer: string
}

const HOT_REQUESTS: DoubanHotRequest[] = [
  {
    category: 'movie',
    path: 'movie',
    categoryParam: '热门',
    defaultType: '全部',
    supportedTypes: ['全部', '华语', '欧美', '韩国', '日本'],
    referer: DOUBAN_MOVIE_REFERER,
  },
  {
    category: 'tv',
    path: 'tv',
    categoryParam: 'tv',
    defaultType: 'tv_domestic',
    supportedTypes: ['tv_domestic', 'tv_american', 'tv_japanese', 'tv_korean'],
    referer: DOUBAN_TV_REFERER,
  },
  {
    category: 'animation',
    path: 'tv',
    categoryParam: 'tv',
    defaultType: 'tv_animation',
    supportedTypes: ['tv_animation'],
    referer: DOUBAN_TV_REFERER,
  },
  {
    category: 'documentary',
    path: 'tv',
    categoryParam: 'tv',
    defaultType: 'tv_documentary',
    supportedTypes: ['tv_documentary'],
    referer: DOUBAN_TV_REFERER,
  },
  {
    category: 'show',
    path: 'tv',
    categoryParam: 'show',
    defaultType: 'show',
    supportedTypes: ['show', 'show_domestic', 'show_foreign'],
    referer: DOUBAN_TV_REFERER,
  },
]

/** 获取并归一化豆瓣热门内容 */
export class DoubanService {
  private recentHotRequest?: Promise<RecommendationItem[]>
  private readonly hotPageRequests = new Map<string, Promise<HotRecommendationsPage>>()

  constructor(private readonly network: ContentNetworkService) {}

  async getRecentHot(): Promise<RecommendationItem[]> {
    if (!this.recentHotRequest) {
      this.recentHotRequest = Promise.allSettled(
        HOT_REQUESTS.map(async (request) => {
          const response = await this.requestRecentHot(
            request,
            request.defaultType,
            0,
            request.category === 'movie' ? 12 : 8,
          )

          return normalizeDoubanItems(response.items ?? [], request.category)
        }),
      )
        .then((responses) =>
          responses.flatMap((response, index) => {
            if (response.status === 'fulfilled') return response.value
            const request = HOT_REQUESTS[index]
            console.warn(
              `[豆瓣 API] 分类加载失败 | 分类=${request.category} | 类型=${request.defaultType} | 原因=${getErrorMessage(response.reason)}`,
            )
            return []
          }),
        )
        .finally(() => {
          this.recentHotRequest = undefined
        })
    }

    return this.recentHotRequest
  }

  async getRecentHotPage(input: HotRecommendationsRequest): Promise<HotRecommendationsPage> {
    const start = Math.max(0, input.start)
    const limit = clamp(input.limit, 1, 50)
    const request = getHotRequest(input.category, input.type)
    const cacheKey = `${input.category}:${input.type}:${start}:${limit}`
    const cachedRequest = this.hotPageRequests.get(cacheKey)

    if (cachedRequest) {
      return cachedRequest
    }

    const pageRequest = this.loadRecentHotPage(request, input.type, start, limit).finally(() => {
      this.hotPageRequests.delete(cacheKey)
    })

    this.hotPageRequests.set(cacheKey, pageRequest)
    return pageRequest
  }

  private async loadRecentHotPage(
    request: DoubanHotRequest,
    type: HotRecommendationType,
    start: number,
    limit: number,
  ): Promise<HotRecommendationsPage> {
    const response = await this.requestRecentHot(request, type, start, limit)
    const items = normalizeDoubanItems(response.items ?? [], request.category)

    return {
      items,
      start,
      limit,
      nextStart: start + items.length,
      hasMore: items.length >= limit,
    }
  }

  private async requestRecentHot(
    request: DoubanHotRequest,
    type: HotRecommendationType,
    start: number,
    limit: number,
  ): Promise<DoubanRecentHotResponse> {
    const url = buildRecentHotUrl(request, type, start, limit)
    const requestId = randomUUID()
    const startedAt = Date.now()
    console.info(`[豆瓣 API] 开始 | requestId=${requestId} | 网络=固定直连 | 目标=m.douban.com`)

    try {
      const result = await this.network.withDoubanContext((context) => requestDoubanJson(url, request.referer, context))
      console.info(
        `[豆瓣 API] 成功 | requestId=${requestId} | 网络=固定直连 | 目标=m.douban.com | 状态码=200 | Content-Type=application/json | 耗时=${Date.now() - startedAt}ms`,
      )
      return result
    } catch (error) {
      const details = getDoubanRequestError(error)
      console.warn(
        `[豆瓣 API] 失败 | requestId=${requestId} | 网络=固定直连 | 目标=m.douban.com | 状态码=${details.status ?? '—'} | Content-Type=${details.contentType ?? '—'} | 原因=${details.message} | 耗时=${Date.now() - startedAt}ms`,
      )
      throw new Error(details.message)
    }
  }
}

interface DoubanRequestErrorDetails {
  message: string
  status?: number
  contentType?: string
}

async function requestDoubanJson(
  url: string,
  referer: string,
  context: ContentNetworkContext,
): Promise<DoubanRecentHotResponse> {
  return new Promise((resolve, reject) => {
    let settled = false
    const request = net.request({
      method: 'GET',
      url,
      session: context.session,
      redirect: 'follow',
      headers: { Referer: referer },
      origin: new URL(referer).origin,
      referrerPolicy: 'unsafe-url',
    })
    const timeoutId = setTimeout(() => {
      request.abort()
      finish(() => reject({ message: '请求超时' } satisfies DoubanRequestErrorDetails))
    }, 12_000)

    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      callback()
    }

    request.on('response', (response) => {
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk) => {
        size += chunk.byteLength
        if (size > 5 * 1024 * 1024) {
          request.abort()
          finish(() => reject({ message: '响应内容超过大小限制' } satisfies DoubanRequestErrorDetails))
          return
        }
        chunks.push(chunk)
      })
      response.on('error', () => finish(() => reject({ message: '网络请求失败' } satisfies DoubanRequestErrorDetails)))
      response.on('end', () => {
        const contentType = getResponseHeader(response.headers, 'content-type')
        if (response.statusCode < 200 || response.statusCode >= 300) {
          finish(() =>
            reject({
              message: `上游返回 HTTP ${response.statusCode}`,
              status: response.statusCode,
              contentType,
            } satisfies DoubanRequestErrorDetails),
          )
          return
        }
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as DoubanRecentHotResponse
          finish(() => resolve(body))
        } catch {
          finish(() => reject({ message: '响应不是有效的 JSON', status: response.statusCode, contentType }))
        }
      })
    })
    request.on('error', () => finish(() => reject({ message: '网络请求失败' } satisfies DoubanRequestErrorDetails)))
    request.end()
  })
}

function getResponseHeader(headers: Record<string, string | string[]>, name: string): string | undefined {
  const value = headers[name.toLowerCase()]
  return (Array.isArray(value) ? value[0] : value)?.split(';', 1)[0]
}

function getDoubanRequestError(error: unknown): DoubanRequestErrorDetails {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    const details = error as Partial<DoubanRequestErrorDetails>
    const message = (error as { message: string }).message
    return {
      message: message.replace(/\s+/g, ' ').slice(0, 120),
      status: details.status,
      contentType: details.contentType,
    }
  }
  return { message: '网络请求失败' }
}

/** 为豆瓣 Session 配置请求 Referer */
export function configureDoubanSessionHeaders(session: Session): void {
  session.webRequest.onBeforeSendHeaders(
    {
      urls: ['https://m.douban.com/*', 'https://*.doubanio.com/*'],
    },
    (details, callback) => {
      callback({
        requestHeaders: setRequestHeader(details.requestHeaders, 'Referer', getDoubanReferer(details.url)),
      })
    },
  )
}

function getDoubanReferer(url: string): string {
  try {
    const target = new URL(url)
    if (target.hostname === 'm.douban.com' && target.pathname.endsWith('/tv')) {
      return DOUBAN_TV_REFERER
    }
  } catch {
    // 无法识别 URL 时使用豆瓣电影页作为默认 Referer。
  }
  return DOUBAN_MOVIE_REFERER
}

function setRequestHeader(headers: Record<string, string>, name: string, value: string): Record<string, string> {
  const normalizedName = name.toLowerCase()
  return {
    ...(omitBy(headers, (_value, key) => key.toLowerCase() === normalizedName) as Record<string, string>),
    [name]: value,
  }
}

function getHotRequest(category: RecommendationItem['category'], type: HotRecommendationType): DoubanHotRequest {
  const request = HOT_REQUESTS.find((item) => item.category === category)

  if (!request) {
    throw new Error(`不支持的热门分类：${category}`)
  }

  if (!request.supportedTypes.includes(type)) {
    throw new Error(`分类 ${category} 不支持筛选项：${type}`)
  }

  return request
}

function buildRecentHotUrl(
  request: DoubanHotRequest,
  type: HotRecommendationType,
  start: number,
  limit: number,
): string {
  const url = new URL(`https://m.douban.com/rexxar/api/v2/subject/recent_hot/${request.path}`)
  url.searchParams.set('start', String(start))
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('category', request.categoryParam)
  url.searchParams.set('type', type)

  return url.toString()
}

function normalizeDoubanItems(items: unknown[], category: RecommendationItem['category']): RecommendationItem[] {
  return items.filter(isRecord).map((item) => normalizeDoubanItem(item, category))
}

function normalizeDoubanItem(
  item: Record<string, unknown>,
  category: RecommendationItem['category'],
): RecommendationItem {
  const pic = isRecord(item.pic) ? item.pic : undefined
  const rating = isRecord(item.rating) ? item.rating : undefined

  return {
    id: getString(item.id),
    title: getString(item.title),
    subtitle: getOptionalString(item.card_subtitle) ?? getOptionalString(item.episodes_info),
    poster: getOptionalString(pic?.large) ?? getOptionalString(pic?.normal),
    rating: getNumber(rating?.value),
    ratingStarCount: getNumber(rating?.star_count),
    isNew: item.is_new === true,
    category,
    raw: item,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getString(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return ''
}

function getOptionalString(value: unknown): string | undefined {
  const nextValue = getString(value)
  return nextValue.length > 0 ? nextValue : undefined
}

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/\s+/g, ' ').slice(0, 120)
  return '请求失败'
}
