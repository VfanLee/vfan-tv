import type {
  VodApiCategory,
  VodApiItem,
  VodApiResponse,
  VodCatalogPage,
  VodCatalogRequest,
  VodSearchResult,
  VodSourceConfig,
} from '@shared/types'

/** 构造兼容 CMS 接口的关键词搜索 URL */
export function buildVodSearchUrl(sourceUrl: string, keyword: string): string {
  return buildVodCatalogUrl(sourceUrl, { sourceId: '', keyword, page: 1 })
}

/** 构造带分页及可选分类、关键词条件的 CMS 列表 URL */
export function buildVodCatalogUrl(sourceUrl: string, input: VodCatalogRequest): string {
  const url = new URL(sourceUrl)
  url.searchParams.set('ac', 'list')
  url.searchParams.set('pg', String(Math.max(1, Math.floor(input.page))))
  if (input.categoryId?.trim()) url.searchParams.set('t', input.categoryId.trim())
  if (input.keyword?.trim()) url.searchParams.set('wd', input.keyword.trim())
  return url.toString()
}

/** 构造支持批量视频 ID 的 CMS 详情 URL */
export function buildVodDetailUrl(sourceUrl: string, vodIds: string[]): string {
  const url = new URL(sourceUrl)
  url.searchParams.set('ac', 'detail')
  url.searchParams.set('ids', vodIds.join(','))
  return url.toString()
}

/** 将不同 CMS 的列表响应归一化为应用点播条目，并附加来源信息 */
export function normalizeVodApiResponse(
  response: VodApiResponse | unknown,
  source: VodSourceConfig,
): VodSearchResult[] {
  if (!isRecord(response) || !Array.isArray(response.list)) {
    return []
  }

  return response.list
    .filter(isRecord)
    .map((item) => normalizeVodItem(item as VodApiItem, source))
    .filter((item) => item.title.length > 0)
}

/** 将 CMS 分类、分页元数据和条目归一化为应用目录页 */
export function normalizeVodCatalogPage(response: VodApiResponse | unknown, source: VodSourceConfig): VodCatalogPage {
  const record = isRecord(response) ? response : {}
  return {
    categories: normalizeCategories(record.class),
    items: normalizeVodApiResponse(response, source),
    page: getPositiveNumber(record.page, 1),
    pageCount: getPositiveNumber(record.pagecount, 1),
    pageSize: getPositiveNumber(record.limit, 0),
    total: getPositiveNumber(record.total, 0),
  }
}

function normalizeCategories(value: unknown): VodCatalogPage['categories'] {
  if (!Array.isArray(value)) return []
  const categories = new Map<string, VodCatalogPage['categories'][number]>()

  for (const item of value) {
    if (!isRecord(item)) continue
    const category = item as unknown as VodApiCategory
    const id = getString(category.type_id)
    const name = getString(category.type_name)
    if (!id || !name) continue
    categories.set(id, { id, name, parentId: getString(category.type_pid) || '0' })
  }

  return [...categories.values()]
}

function normalizeVodItem(item: VodApiItem, source: VodSourceConfig): VodSearchResult {
  const rawJson = safeJsonStringify(item)

  return {
    sourceId: source.id,
    sourceName: source.name,
    sourceUrl: source.url,
    vodId: getString(item.vod_id),
    title: getString(item.vod_name),
    subtitle: getOptionalString(item.vod_sub),
    poster: getOptionalString(item.vod_pic),
    year: getOptionalString(item.vod_year),
    area: getOptionalString(item.vod_area),
    language: getOptionalString(item.vod_lang),
    category: getOptionalString(item.type_name) ?? getOptionalString(item.vod_class),
    remarks: getOptionalString(item.vod_remarks),
    actor: getOptionalString(item.vod_actor),
    director: getOptionalString(item.vod_director),
    description: stripHtml(getOptionalString(item.vod_content)),
    raw: item,
    rawJson,
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

function getPositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function stripHtml(value: string | undefined): string | undefined {
  return value
    ?.replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function safeJsonStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}
