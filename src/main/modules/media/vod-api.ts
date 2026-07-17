import type { VodApiItem, VodApiResponse, VodSearchResult, VodSourceConfig } from '@shared/types'

// 兼容不同 CMS 返回形态：本模块只做协议归一化，不承担网络请求和业务筛选。
export function buildVodSearchUrl(sourceUrl: string, keyword: string): string {
  const url = new URL(sourceUrl)
  url.searchParams.set('ac', 'detail')
  url.searchParams.set('wd', keyword)
  url.searchParams.set('pagesize', '30')
  return url.toString()
}

export function normalizeVodApiResponse(
  response: VodApiResponse | unknown,
  source: VodSourceConfig,
): VodSearchResult[] {
  if (!isRecord(response) || !Array.isArray(response.list)) {
    return []
  }

  return response.list
    .filter(isRecord)
    .map((item) => normalizeVodItem(keepOnlyM3u8PlayUrls(item as VodApiItem), source))
    .filter((item) => item.title.length > 0)
}

function keepOnlyM3u8PlayUrls(item: VodApiItem): VodApiItem {
  const playUrl = getString(item.vod_play_url)

  if (!playUrl) {
    return item
  }

  const playFromLines = getString(item.vod_play_from).split('$$$')
  const playNoteLines = getString(item.vod_play_note).split('$$$')
  const playServerLines = getString(item.vod_play_server).split('$$$')
  const nextPlayFrom: string[] = []
  const nextPlayNotes: string[] = []
  const nextPlayServers: string[] = []
  const nextPlayUrls: string[] = []

  playUrl.split('$$$').forEach((rawLine, lineIndex) => {
    const episodes = rawLine
      .split('#')
      .map((episode) => episode.trim())
      .filter((episode) => /\.m3u8(?:$|[?#])/i.test(episode))

    if (episodes.length > 0) {
      nextPlayFrom.push(playFromLines[lineIndex]?.trim() || `m3u8-${nextPlayFrom.length + 1}`)
      nextPlayNotes.push(playNoteLines[lineIndex]?.trim() ?? '')
      nextPlayServers.push(playServerLines[lineIndex]?.trim() ?? '')
      nextPlayUrls.push(episodes.join('#'))
    }
  })

  return {
    ...item,
    vod_play_from: nextPlayFrom.join('$$$'),
    vod_play_note: nextPlayNotes.join('$$$'),
    vod_play_server: nextPlayServers.join('$$$'),
    vod_play_url: nextPlayUrls.join('$$$'),
  }
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
