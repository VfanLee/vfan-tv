import type {
  HotRecommendationType,
  HotRecommendationsPage,
  HotRecommendationsRequest,
  RecommendationItem,
} from '@shared/types'
import type { HttpClient } from './http-client'

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
    referer: 'https://movie.douban.com/explore',
  },
  {
    category: 'tv',
    path: 'tv',
    categoryParam: 'tv',
    defaultType: 'tv',
    supportedTypes: ['tv', 'tv_domestic', 'tv_american', 'tv_japanese', 'tv_korean', 'tv_animation', 'tv_documentary'],
    referer: 'https://movie.douban.com/tv/',
  },
  {
    category: 'show',
    path: 'tv',
    categoryParam: 'show',
    defaultType: 'show',
    supportedTypes: ['show', 'show_domestic', 'show_foreign'],
    referer: 'https://movie.douban.com/tv/',
  },
]

export class DoubanService {
  private recentHotRequest?: Promise<RecommendationItem[]>
  private readonly hotPageRequests = new Map<string, Promise<HotRecommendationsPage>>()

  constructor(private readonly httpClient: HttpClient) {}

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
      ).then((responses) => responses.flatMap((response) => (response.status === 'fulfilled' ? response.value : [])))
    }

    return this.recentHotRequest
  }

  async getRecentHotPage(input: HotRecommendationsRequest): Promise<HotRecommendationsPage> {
    const start = Math.max(0, input.start)
    const limit = Math.min(Math.max(input.limit, 1), 50)
    const request = getHotRequest(input.category, input.type)
    const cacheKey = `${input.category}:${input.type}:${start}:${limit}`
    const cachedRequest = this.hotPageRequests.get(cacheKey)

    if (cachedRequest) {
      return cachedRequest
    }

    const pageRequest = this.loadRecentHotPage(request, input.type, start, limit).catch((error: unknown) => {
      this.hotPageRequests.delete(cacheKey)
      throw error
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
    return this.httpClient.get<DoubanRecentHotResponse>(buildRecentHotUrl(request, type, start, limit), {
      headers: {
        Referer: request.referer,
        Origin: 'https://movie.douban.com',
        Accept: 'application/json, text/plain, */*',
      },
      timeout: 12_000,
    })
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
