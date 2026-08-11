import type { RadioCategory, RadioChannel, RadioLiveProgram, RadioRegion, RadioSearchResult } from '@shared/types'
import type { Session } from 'electron'
import { compact, uniq } from 'es-toolkit/array'
import { clamp } from 'es-toolkit/math'
import { omitBy } from 'es-toolkit/object'
import type { HttpClient } from '../../infrastructure/http/http-client'
import type { ContentNetworkService } from '../../infrastructure/network/content-network.service'
import type { MediaProxyServer } from '../media/media-proxy-server'

const QTFM_API_BASE_URL = 'https://rapi.qtfm.cn'
const QINGTING_API_BASE_URL = 'https://rapi.qingting.fm'
const QINGTING_SEARCH_BASE_URL = 'https://search.qingting.fm'
const QINGTING_AUDIO_REFERER = 'https://ls.qingting.fm/'

type UnknownRecord = Record<string, unknown>

/** 获取并归一化蜻蜓广播分类、频道、节目单和播放地址 */
export class RadioService {
  constructor(
    private readonly httpClient: HttpClient,
    private readonly proxyServer: MediaProxyServer,
    private readonly network: ContentNetworkService,
  ) {}

  async getCategories(): Promise<RadioCategory[]> {
    const response = await this.get<unknown>(`${QTFM_API_BASE_URL}/categories?type=channel`)
    return compact(asArray(getPayload(response)).map(toCategory))
  }

  async getCategoryChannels(categoryId: number, page = 1, pageSize = 20): Promise<RadioChannel[]> {
    const url = new URL(`${QTFM_API_BASE_URL}/categories/${normalizeId(categoryId)}/channels`)
    url.searchParams.set('page', String(normalizePage(page)))
    url.searchParams.set('pagesize', String(normalizePageSize(pageSize)))
    const response = await this.get<unknown>(url.toString())
    return compact(asArray(getPayload(response)).map(toChannel))
  }

  async getChannelDetail(channelId: number): Promise<RadioChannel> {
    const response = await this.get<unknown>(`${QINGTING_API_BASE_URL}/v4/channels/${normalizeId(channelId)}`)
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
    const payload = getPayload(await this.get<unknown>(url.toString()))
    const record = asRecord(payload)
    const data = asRecord(record?.data)
    const items = compact(asArray(data?.docs).map(toChannel))
    const total = asNumber(data?.numFound)
    return {
      items,
      hasMore: total != null ? normalizePage(page) * normalizePageSize(pageSize) < total : items.length >= pageSize,
    }
  }

  async getLivePrograms(channelIds: number[]): Promise<RadioLiveProgram[]> {
    const ids = uniq(channelIds.map(normalizeId).filter(Boolean))
    if (!ids.length) return []

    const url = new URL(`${QINGTING_API_BASE_URL}/v2/livechannelplaying`)
    url.searchParams.set('ids', ids.join(','))
    url.searchParams.set('current_time', String(Math.floor(Date.now() / 1000)))
    return compact(asArray(getPayload(await this.get<unknown>(url.toString()))).map(toLiveProgram))
  }

  async getRegions(): Promise<RadioRegion[]> {
    const response = await this.get<unknown>(`${QTFM_API_BASE_URL}/regions?all=true`)
    return compact(asArray(getPayload(response)).map(toRegion))
  }

  async getBillboard(categoryId: number, regionId: number): Promise<RadioChannel[]> {
    const response = await this.get<unknown>(
      `${QTFM_API_BASE_URL}/billboards/${normalizeId(categoryId)}/${normalizeId(regionId)}/channels`,
    )
    return compact(asArray(getPayload(response)).map(toChannel))
  }

  async getPlaybackUrl(channelId: number): Promise<string> {
    const id = normalizeId(channelId)
    if (!id) throw new Error('电台频道无效')
    const url = `https://ls.qingting.fm/live/${id}/64k.m3u8`
    return this.proxyServer.createMediaUrl(url, { headers: {} }, this.network.getContext('radio'))
  }

  private async get<T>(url: string): Promise<T> {
    return this.httpClient.get<T>(url, { requestLabel: '电台 API' })
  }
}

/** 为蜻蜓音频 Session 配置请求 Referer */
export function configureRadioSessionHeaders(session: Session): void {
  session.webRequest.onBeforeSendHeaders({ urls: ['https://ls.qingting.fm/*'] }, (details, callback) => {
    callback({
      requestHeaders: setRequestHeader(details.requestHeaders, 'Referer', QINGTING_AUDIO_REFERER),
    })
  })
}

function setRequestHeader(headers: Record<string, string>, name: string, value: string): Record<string, string> {
  const normalizedName = name.toLowerCase()
  return {
    ...(omitBy(headers, (_value, key) => key.toLowerCase() === normalizedName) as Record<string, string>),
    [name]: value,
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
  return clamp(Number.isInteger(value) ? value : 20, 1, 50)
}
