import { createHash } from 'crypto'
import { gunzipSync } from 'zlib'
import { DOMParser } from '@xmldom/xmldom'
import type {
  IptvChannel,
  IptvChannelPrograms,
  IptvEpgProgram,
  IptvEpgSettings,
  IptvEpgTestResult,
  IptvPlaylist,
  IptvProgramScheduleResult,
  IptvProgramsResult,
} from '@shared/types'
import type { HttpClient } from '../../infrastructure/http/http-client'
import type { SettingsService } from '../settings/settings.service'
import type { IptvCacheRepository } from './iptv-cache.repository'
import type { IptvCatalogService } from './iptv-catalog.service'

const QUERY_CACHE_MS = 30 * 60 * 1_000
const XMLTV_CACHE_MS = 2 * 60 * 60 * 1_000
const MAX_EPG_SIZE = 100 * 1024 * 1024
const EPG_CACHE_NAMESPACE = 'iptv-epg-v2'

interface EpgProvider {
  type: 'query' | 'xmltv'
  url: string
  label: string
}

export class IptvEpgService {
  private activeQueryCount = 0
  private readonly queryWaiters: Array<() => void> = []

  constructor(
    private readonly httpClient: HttpClient,
    private readonly settingsService: SettingsService,
    private readonly catalogService: IptvCatalogService,
    private readonly cacheRepository: IptvCacheRepository,
  ) {}

  async getPrograms(sourceId: string, channelIds: string[]): Promise<IptvProgramsResult> {
    const playlist = await this.catalogService.get(sourceId)
    const channels = channelIds
      .map((id) => playlist.channels.find((channel) => channel.id === id))
      .filter((channel): channel is IptvChannel => Boolean(channel))
    if (!channels.length) return { items: [], fallback: false }

    const selected = resolveGlobalProvider(this.settingsService.get().iptvEpg, playlist)
    if (!selected) return { items: emptyPrograms(channels), fallback: false }

    try {
      const programs = await this.loadProvider(selected, channels, formatDate(new Date()))
      const items = channels.map((channel) => selectCurrentAndNext(channel.id, programs.get(channel.id) ?? []))
      this.recordSuccess(selected.label)
      return { items, actualSource: selected.label, fallback: false }
    } catch (error) {
      const fallbackProvider = resolveEmbeddedProvider(playlist)
      if (!fallbackProvider || sameProvider(selected, fallbackProvider)) {
        return {
          items: emptyPrograms(channels),
          actualSource: selected.label,
          fallback: false,
          errorMessage: toPublicError(error),
        }
      }
      try {
        const programs = await this.loadProvider(fallbackProvider, channels, formatDate(new Date()))
        const items = channels.map((channel) => selectCurrentAndNext(channel.id, programs.get(channel.id) ?? []))
        this.recordSuccess(fallbackProvider.label)
        return {
          items,
          actualSource: fallbackProvider.label,
          fallback: true,
          errorMessage: toPublicError(error),
        }
      } catch (fallbackError) {
        return {
          items: emptyPrograms(channels),
          actualSource: selected.label,
          fallback: true,
          errorMessage: `${toPublicError(error)}；内嵌 EPG：${toPublicError(fallbackError)}`,
        }
      }
    }
  }

  async getProgramSchedule(sourceId: string, channelId: string, date: string): Promise<IptvProgramScheduleResult> {
    if (!isDateKey(date)) throw new Error('节目单日期格式无效')
    const playlist = await this.catalogService.get(sourceId)
    const channel = playlist.channels.find((item) => item.id === channelId)
    if (!channel) throw new Error('频道不存在')

    const selected = resolveGlobalProvider(this.settingsService.get().iptvEpg, playlist)
    if (!selected) return { channelId, date, programs: [], fallback: false }

    try {
      const programs = (await this.loadProvider(selected, [channel], date)).get(channel.id) ?? []
      this.recordSuccess(selected.label)
      return {
        channelId,
        date,
        programs: bindPrograms(channel.id, programs),
        actualSource: selected.label,
        fallback: false,
      }
    } catch (error) {
      const fallbackProvider = resolveEmbeddedProvider(playlist)
      if (!fallbackProvider || sameProvider(selected, fallbackProvider)) {
        return {
          channelId,
          date,
          programs: [],
          actualSource: selected.label,
          fallback: false,
          errorMessage: toPublicError(error),
        }
      }
      try {
        const programs = (await this.loadProvider(fallbackProvider, [channel], date)).get(channel.id) ?? []
        this.recordSuccess(fallbackProvider.label)
        return {
          channelId,
          date,
          programs: bindPrograms(channel.id, programs),
          actualSource: fallbackProvider.label,
          fallback: true,
          errorMessage: toPublicError(error),
        }
      } catch (fallbackError) {
        return {
          channelId,
          date,
          programs: [],
          actualSource: selected.label,
          fallback: true,
          errorMessage: `${toPublicError(error)}；内嵌 EPG：${toPublicError(fallbackError)}`,
        }
      }
    }
  }

  async test(input?: IptvEpgSettings): Promise<IptvEpgTestResult> {
    const settings = input ?? this.settingsService.get().iptvEpg
    const provider = resolveGlobalProvider(settings)
    const testedAt = Date.now()
    if (!provider) return { status: 'success', testedAt, elapsedMs: 0, actualSource: '跟随 IPTV 源' }
    const startedAt = performance.now()
    try {
      if (provider.type === 'xmltv') {
        const data = await this.fetchBuffer(provider.url)
        const xml = decodeMaybeGzip(data, provider.url)
        const document = new DOMParser().parseFromString(xml, 'application/xml')
        if (!document.getElementsByTagName('tv').length && !document.getElementsByTagName('programme').length) {
          throw new Error('响应不是有效的 XMLTV')
        }
      } else {
        const url = buildQueryUrl(provider.url, 'CCTV1', formatDate(new Date()))
        await this.httpClient.get<unknown>(url, {
          requestLabel: 'IPTV EPG',
          timeout: 8_000,
          maxContentLength: 2 * 1024 * 1024,
        })
      }
      return {
        status: 'success',
        testedAt,
        elapsedMs: Math.max(1, Math.round(performance.now() - startedAt)),
        actualSource: provider.label,
      }
    } catch (error) {
      return { status: 'error', testedAt, errorMessage: toPublicError(error), actualSource: provider.label }
    }
  }

  private async loadProvider(
    provider: EpgProvider,
    channels: IptvChannel[],
    date: string,
  ): Promise<Map<string, IptvEpgProgram[]>> {
    if (provider.type === 'xmltv') return this.loadXmltv(provider, channels, date)
    const entries = await mapLimit(
      channels,
      4,
      async (channel) => [channel.id, await this.loadQueryChannel(provider, channel, date)] as const,
    )
    return new Map(entries)
  }

  private async loadQueryChannel(provider: EpgProvider, channel: IptvChannel, date: string): Promise<IptvEpgProgram[]> {
    const channelKey = channel.tvgId || channel.tvgName || normalizeChannelName(channel.title)
    const cacheKey = providerCacheKey(provider)
    let programs = this.cacheRepository.getPrograms(cacheKey, channelKey, date)
    if (!programs) {
      const response = await this.runLimitedQuery(() =>
        this.httpClient.get<unknown>(buildQueryUrl(provider.url, channel.tvgName || channel.title, date), {
          requestLabel: 'IPTV EPG',
          timeout: 8_000,
          maxContentLength: 2 * 1024 * 1024,
        }),
      )
      programs = parseQueryPrograms(response, channel.id, date)
      this.cacheRepository.savePrograms(cacheKey, channelKey, date, programs, Date.now() + QUERY_CACHE_MS)
    }
    return programs
  }

  private async loadXmltv(
    provider: EpgProvider,
    channels: IptvChannel[],
    date: string,
  ): Promise<Map<string, IptvEpgProgram[]>> {
    const cacheKey = providerCacheKey(provider)
    if (!this.cacheRepository.isProviderFresh(cacheKey)) {
      const xml = decodeMaybeGzip(await this.fetchBuffer(provider.url), provider.url)
      const parsed = parseXmltv(xml)
      const expiresAt = Date.now() + XMLTV_CACHE_MS
      const retainedDates = new Set(getScheduleDates())
      for (const [channelKey, programs] of parsed.entries()) {
        const programsByDate = new Map<string, IptvEpgProgram[]>()
        for (const program of programs) {
          const programDate = formatDate(new Date(program.startAt))
          if (!retainedDates.has(programDate)) continue
          const values = programsByDate.get(programDate) ?? []
          values.push(program)
          programsByDate.set(programDate, values)
        }
        for (const retainedDate of retainedDates) {
          this.cacheRepository.savePrograms(
            cacheKey,
            channelKey,
            retainedDate,
            programsByDate.get(retainedDate) ?? [],
            expiresAt,
          )
        }
      }
      this.cacheRepository.saveProviderMetadata(cacheKey, provider.url, provider.type, expiresAt)
    }

    return new Map(
      channels.map((channel) => {
        const keys = [channel.tvgId, channel.tvgName, channel.title]
          .filter((value): value is string => Boolean(value))
          .flatMap((value) => [value, normalizeChannelName(value)])
        const programs = keys.map((key) => this.cacheRepository.getPrograms(cacheKey, key, date)).find(Boolean) ?? []
        return [channel.id, programs] as const
      }),
    )
  }

  private fetchBuffer(url: string): Promise<Buffer> {
    return this.httpClient.get<Buffer>(url, {
      requestLabel: 'IPTV EPG',
      responseType: 'arraybuffer',
      maxContentLength: MAX_EPG_SIZE,
      timeout: 20_000,
    })
  }

  private recordSuccess(source: string): void {
    const settings = this.settingsService.get()
    this.settingsService.update({
      iptvEpg: { ...settings.iptvEpg, lastSuccessAt: Date.now(), lastSuccessSource: source },
    })
  }

  private async runLimitedQuery<T>(request: () => Promise<T>): Promise<T> {
    if (this.activeQueryCount >= 4) {
      await new Promise<void>((resolve) => this.queryWaiters.push(resolve))
    }
    this.activeQueryCount += 1
    try {
      return await request()
    } finally {
      this.activeQueryCount -= 1
      this.queryWaiters.shift()?.()
    }
  }
}

function resolveGlobalProvider(settings: IptvEpgSettings, playlist?: IptvPlaylist): EpgProvider | undefined {
  if (settings.mode === 'source') return playlist ? resolveEmbeddedProvider(playlist) : undefined
  const url = settings.url?.trim()
  if (!url) throw new Error('请填写 EPG 地址')
  return {
    type: settings.mode,
    url,
    label: settings.mode === 'query' ? '自定义查询 EPG' : '自定义 XMLTV',
  }
}

function resolveEmbeddedProvider(playlist: IptvPlaylist): EpgProvider | undefined {
  const url = playlist.sourceEpgUrls[0] ?? playlist.channels.find((channel) => channel.epgUrl)?.epgUrl
  if (!url) return undefined
  return { type: /(?:\.xml|\.xml\.gz|\.gz)(?:$|[?#])/i.test(url) ? 'xmltv' : 'query', url, label: 'IPTV 源内嵌 EPG' }
}

function sameProvider(left: EpgProvider, right: EpgProvider): boolean {
  return left.type === right.type && left.url === right.url
}

function providerCacheKey(provider: EpgProvider): string {
  return createHash('sha1').update(`${EPG_CACHE_NAMESPACE}:${provider.type}:${provider.url}`).digest('hex')
}

function buildQueryUrl(template: string, channel: string, date: string): string {
  if (template.includes('{name}') || template.includes('{date}')) {
    return template.replaceAll('{name}', encodeURIComponent(channel)).replaceAll('{date}', encodeURIComponent(date))
  }
  const url = new URL(template)
  url.searchParams.set('ch', channel)
  url.searchParams.set('date', date)
  return url.toString()
}

function parseQueryPrograms(payload: unknown, channelId: string, date: string): IptvEpgProgram[] {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : undefined
  const candidates = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.data)
      ? record.data
      : Array.isArray(record?.epg_data)
        ? record.epg_data
        : Array.isArray(record?.programs)
          ? record.programs
          : []
  return candidates.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const value = item as Record<string, unknown>
    const title = String(value.title ?? value.name ?? value.program ?? '').trim()
    const startAt = parseFlexibleTime(value.startAt ?? value.start ?? value.start_time ?? value.startTime, date)
    const endAt = parseFlexibleTime(value.endAt ?? value.end ?? value.end_time ?? value.endTime, date)
    if (!title || !startAt || !endAt || endAt <= startAt) return []
    return [{ id: `${channelId}:${startAt}:${index}`, channelId, title, startAt, endAt }]
  })
}

function parseXmltv(xml: string): Map<string, IptvEpgProgram[]> {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.getElementsByTagName('parsererror').length) throw new Error('XMLTV 解析失败')
  const aliases = new Map<string, Set<string>>()
  for (const node of Array.from(document.getElementsByTagName('channel'))) {
    const id = node.getAttribute('id')?.trim()
    if (!id) continue
    const keys = new Set([id, normalizeChannelName(id)])
    for (const displayName of Array.from(node.getElementsByTagName('display-name'))) {
      const name = displayName.textContent?.trim()
      if (name) {
        keys.add(name)
        keys.add(normalizeChannelName(name))
      }
    }
    aliases.set(id, keys)
  }
  const byId = new Map<string, IptvEpgProgram[]>()
  for (const [index, node] of Array.from(document.getElementsByTagName('programme')).entries()) {
    const channelKey = node.getAttribute('channel')?.trim()
    const title = node.getElementsByTagName('title')[0]?.textContent?.trim()
    const startAt = parseXmltvTime(node.getAttribute('start'))
    const endAt = parseXmltvTime(node.getAttribute('stop'))
    if (!channelKey || !title || !startAt || !endAt || endAt <= startAt) continue
    const program: IptvEpgProgram = {
      id: `${channelKey}:${startAt}:${index}`,
      channelId: channelKey,
      title,
      startAt,
      endAt,
    }
    const values = byId.get(channelKey) ?? []
    values.push(program)
    byId.set(channelKey, values)
  }
  const result = new Map<string, IptvEpgProgram[]>()
  for (const [id, programs] of byId) {
    programs.sort((left, right) => left.startAt - right.startAt)
    for (const key of aliases.get(id) ?? new Set([id, normalizeChannelName(id)])) result.set(key, programs)
  }
  return result
}

function parseXmltvTime(value: string | null): number | undefined {
  if (!value) return undefined
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-])(\d{2})(\d{2})?/.exec(value)
  if (!match) return parseFlexibleTime(value)
  const local = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +(match[6] ?? 0))
  const offset = (+match[8] * 60 + +(match[9] ?? 0)) * 60_000
  return local - (match[7] === '+' ? offset : -offset)
}

function parseFlexibleTime(value: unknown, date?: string): number | undefined {
  if (typeof value === 'number') return value < 10_000_000_000 ? value * 1_000 : value
  if (typeof value !== 'string' || !value.trim()) return undefined
  const timeOnly = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (timeOnly && date) {
    const parsed = new Date(`${date}T00:00:00`)
    parsed.setHours(+timeOnly[1], +timeOnly[2], +(timeOnly[3] ?? 0), 0)
    return parsed.getTime()
  }
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1_000 : numeric
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function decodeMaybeGzip(data: Buffer, url: string): string {
  const buffer = Buffer.from(data)
  const decoded =
    url.toLowerCase().includes('.gz') || (buffer[0] === 0x1f && buffer[1] === 0x8b) ? gunzipSync(buffer) : buffer
  return decoded.toString('utf8')
}

function selectCurrentAndNext(channelId: string, programs: IptvEpgProgram[]): IptvChannelPrograms {
  const now = Date.now()
  const current = programs.find((program) => program.startAt <= now && program.endAt > now)
  const next = programs.find((program) => program.startAt >= (current?.endAt ?? now))
  const bind = (program: IptvEpgProgram | undefined): IptvEpgProgram | undefined =>
    program ? { ...program, channelId } : undefined
  return { channelId, current: bind(current), next: bind(next) }
}

function bindPrograms(channelId: string, programs: IptvEpgProgram[]): IptvEpgProgram[] {
  return programs.map((program) => ({ ...program, channelId }))
}

function emptyPrograms(channels: IptvChannel[]): IptvChannelPrograms[] {
  return channels.map((channel) => ({ channelId: channel.id }))
}

function normalizeChannelName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
    .replace(/高清|超清|频道|hd|uhd|4k/gi, '')
}

function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getScheduleDates(): string[] {
  const today = new Date()
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + index - 3)
    return formatDate(date)
  })
}

function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00`)
  return Number.isFinite(date.getTime()) && formatDate(date) === value
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const result = new Array<R>(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      result[index] = await worker(items[index])
    }
  })
  await Promise.all(runners)
  return result
}

function toPublicError(error: unknown): string {
  if (!(error instanceof Error)) return 'EPG 服务不可用'
  if (error.name === 'TimeoutError' || /timeout/i.test(error.message)) return '请求超时'
  return error.message.replace(/https?:\/\/\S+/g, 'EPG 服务')
}
