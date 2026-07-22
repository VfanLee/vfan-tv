import type { RadioCategory, RadioChannel, RadioLiveProgram, RadioRegion, RadioSearchResult } from '@shared/types'
import type { HttpClient } from '../../infrastructure/http/http-client'

const QTFM_API_BASE_URL = 'https://rapi.qtfm.cn'
const QINGTING_API_BASE_URL = 'https://rapi.qingting.fm'
const QINGTING_SEARCH_BASE_URL = 'https://search.qingting.fm'

type UnknownRecord = Record<string, unknown>

/**
 * 蜻蜓的这些端点没有稳定的公开 SDK；服务层在这里收敛上游字段差异，避免 renderer 依赖其原始结构。
 */
export class RadioService {
  constructor(private readonly httpClient: HttpClient) {}

  async getCategories(): Promise<RadioCategory[]> {
    const response = await this.httpClient.get<unknown>(`${QTFM_API_BASE_URL}/categories?type=channel`)
    return asArray(getPayload(response)).map(toCategory).filter(isDefined)
  }

  async getCategoryChannels(categoryId: number, page = 1, pageSize = 20): Promise<RadioChannel[]> {
    const url = new URL(`${QTFM_API_BASE_URL}/categories/${normalizeId(categoryId)}/channels`)
    url.searchParams.set('page', String(normalizePage(page)))
    url.searchParams.set('pagesize', String(normalizePageSize(pageSize)))
    const response = await this.httpClient.get<unknown>(url.toString())
    return asArray(getPayload(response)).map(toChannel).filter(isDefined)
  }

  async getChannelDetail(channelId: number): Promise<RadioChannel> {
    const response = await this.httpClient.get<unknown>(
      `${QINGTING_API_BASE_URL}/v4/channels/${normalizeId(channelId)}`,
    )
    const channel = toChannel(getPayload(response))
    if (!channel) throw new Error('未找到该电台的详情')
    return channel
  }

  async searchChannels(keyword: string, page = 1, pageSize = 30): Promise<RadioSearchResult> {
    const normalizedKeyword = keyword.trim()
    if (!normalizedKeyword) return { items: [], hasMore: false }

    const url = new URL(`${QINGTING_SEARCH_BASE_URL}/v3/search`)
    url.searchParams.set('k', normalizedKeyword)
    url.searchParams.set('page', String(normalizePage(page)))
    url.searchParams.set('pagesize', String(normalizePageSize(pageSize)))
    url.searchParams.set('include', 'channel_live')
    url.searchParams.set('k_src', 'direct')
    const payload = getPayload(await this.httpClient.get<unknown>(url.toString()))
    const record = asRecord(payload)
    const data = asRecord(record?.data)
    const items = asArray(data?.docs).map(toChannel).filter(isDefined)
    const total = asNumber(data?.numFound)
    return {
      items,
      hasMore: total != null ? normalizePage(page) * normalizePageSize(pageSize) < total : items.length >= pageSize,
    }
  }

  async getLivePrograms(channelIds: number[]): Promise<RadioLiveProgram[]> {
    const ids = [...new Set(channelIds.map(normalizeId).filter(Boolean))]
    if (!ids.length) return []

    const url = new URL(`${QINGTING_API_BASE_URL}/v2/livechannelplaying`)
    url.searchParams.set('ids', ids.join(','))
    url.searchParams.set('current_time', String(Math.floor(Date.now() / 1000)))
    return asArray(getPayload(await this.httpClient.get<unknown>(url.toString())))
      .map(toLiveProgram)
      .filter(isDefined)
  }

  async getRegions(): Promise<RadioRegion[]> {
    const response = await this.httpClient.get<unknown>(`${QTFM_API_BASE_URL}/regions?all=true`)
    return asArray(getPayload(response)).map(toRegion).filter(isDefined)
  }

  async getBillboard(categoryId: number, regionId: number): Promise<RadioChannel[]> {
    const response = await this.httpClient.get<unknown>(
      `${QTFM_API_BASE_URL}/billboards/${normalizeId(categoryId)}/${normalizeId(regionId)}/channels`,
    )
    return asArray(getPayload(response)).map(toChannel).filter(isDefined)
  }
}

function getPayload(response: unknown): unknown {
  const record = asRecord(response)
  if (!record) throw new Error('电台服务返回了无效数据')
  if (record.Success === 'ok') return record.Data
  if (asNumber(record.errcode) === 0) return record.data
  throw new Error(asString(record.Error) || asString(record.errmsg) || '电台服务暂时不可用')
}

function toCategory(value: unknown): RadioCategory | undefined {
  const record = asRecord(value)
  const id = asNumber(record?.id)
  const title = asString(record?.title)
  return id != null && title ? { id, title } : undefined
}

function toRegion(value: unknown): RadioRegion | undefined {
  return toCategory(value)
}

function toChannel(value: unknown): RadioChannel | undefined {
  const record = asRecord(value)
  const id = asNumber(record?.content_id) ?? asNumber(record?.id)
  const title = asString(record?.title) ?? asString(record?.name)
  if (id == null || !title) return undefined
  const nowPlaying = asRecord(record?.nowplaying)
  return {
    id,
    title,
    coverUrl: asString(record?.cover),
    description: asString(record?.description),
    audienceCount: asNumber(record?.audience_count),
    category:
      toCategory(asArray(record?.categories)[0]) ??
      toCategory({ id: record?.top_category_id, title: record?.top_category_title }),
    region: toRegion(record?.region),
    nowPlayingTitle: asString(nowPlaying?.title) ?? asString(nowPlaying?.name),
  }
}

function toLiveProgram(value: unknown): RadioLiveProgram | undefined {
  const record = asRecord(value)
  const channelId = asNumber(record?.id)
  const program = asRecord(record?.program)
  if (channelId == null) return undefined
  return { channelId, title: asString(program?.title) ?? asString(program?.name) }
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : undefined
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(number) ? number : undefined
}

function normalizeId(value: number): number {
  return Number.isInteger(value) && value > 0 ? value : 0
}

function normalizePage(value: number): number {
  return Number.isInteger(value) && value > 0 ? value : 1
}

function normalizePageSize(value: number): number {
  return Math.min(Math.max(Number.isInteger(value) ? value : 20, 1), 50)
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
