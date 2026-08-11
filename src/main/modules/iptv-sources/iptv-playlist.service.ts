import playlistParser, { type PlaylistItem } from 'iptv-playlist-parser'
import { uniq } from 'es-toolkit/array'
import type {
  IptvChannel,
  IptvChannelStream,
  IptvPlaylist,
  IptvStreamRequestHeaders,
  SourceHeaders,
} from '@shared/types'
import type { HttpClient } from '../../infrastructure/http/http-client'
import { resolveSourceRequestHeaders } from '../../infrastructure/http/source-request-headers'

const MAX_PLAYLIST_SIZE = 10 * 1024 * 1024
const DEFAULT_GROUP = '未分组'
const VOD_STREAM_URL_PATTERN = /\.(?:mp4|m4v|mkv|mov|avi|wmv|webm)(?:$|[?#])/i
const STREAM_URL_PATTERN = /https?:\/\/\S+/i
const TEXT_GROUP_MARKERS = new Set(['#genre#', '#group#'])
const IPTV_CONTEXT_KEYWORDS = ['直播', '卫视', '央视', '央卫视']
const VOD_CONTEXT_KEYWORDS = ['点播', '录播', '回放', '春晚']

interface ParsedExtInf {
  title: string
  group: string
  logo?: string
  tvgId?: string
  tvgName?: string
  epgUrl?: string
  requestHeaders?: IptvStreamRequestHeaders
}

interface ParsedPlaylistItem extends ParsedExtInf {
  url: string
}

/** 加载远程 M3U 或文本播放列表，并归一化为保留源站请求头的频道模型 */
export class IptvPlaylistService {
  constructor(private readonly httpClient: HttpClient) {}

  async load(url: string, headers: SourceHeaders): Promise<IptvPlaylist> {
    const parsedUrl = new URL(url)

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('IPTV 源地址仅支持 HTTP 或 HTTPS')
    }

    const playlistResponse = await this.loadPlaylistContent(parsedUrl, headers)

    return parseIptvPlaylist(playlistResponse.content, playlistResponse.url)
  }

  private async loadPlaylistContent(parsedUrl: URL, headers: SourceHeaders): Promise<{ content: string; url: string }> {
    return {
      content: await this.httpClient.get<string>(parsedUrl.toString(), {
        headers: resolveSourceRequestHeaders(parsedUrl.toString(), parsedUrl.toString(), headers),
        requestLabel: 'IPTV 目录',
        responseType: 'text',
        maxContentLength: MAX_PLAYLIST_SIZE,
      }),
      url: parsedUrl.toString(),
    }
  }
}

/** 解析 M3U 或逗号分隔文本播放列表，合并同频道线路并生成稳定标识 */
export function parseIptvPlaylist(content: string, sourceUrl: string): IptvPlaylist {
  const parsed = parsePlaylistItems(content)
  const items = parsed.items
  const channelMap = new Map<string, IptvChannel>()

  for (const item of items) {
    addStream(channelMap, item, item.url)
  }

  const channels = [...channelMap.values()]

  if (channels.length === 0) {
    throw new Error('IPTV 源中没有可播放频道')
  }

  return {
    sourceUrl,
    fetchedAt: Date.now(),
    sourceEpgUrls: parsed.sourceEpgUrls,
    channels,
  }
}

/** 将 M3U 播放列表转换为兼容的分组文本格式；文本输入保持不变 */
export function m3uToTextPlaylist(content: string): string {
  if (!isM3uPlaylist(content)) {
    return content
  }

  return playlistItemsToText(parseM3uPlaylistItems(content))
}

function parsePlaylistItems(content: string): { items: ParsedPlaylistItem[]; sourceEpgUrls: string[] } {
  if (!isM3uPlaylist(content)) return { items: parseTextPlaylistItems(content), sourceEpgUrls: [] }
  const playlist = playlistParser.parse(content)
  const headerUrls = [playlist.header.attrs['x-tvg-url'], ...parseHeaderEpgUrls(playlist.header.raw)]
  return {
    items: playlist.items.flatMap(toParsedPlaylistItem),
    sourceEpgUrls: uniq(headerUrls.flatMap(splitEpgUrls).filter(Boolean)),
  }
}

function parseM3uPlaylistItems(content: string): ParsedPlaylistItem[] {
  return playlistParser.parse(content).items.flatMap(toParsedPlaylistItem)
}

function toParsedPlaylistItem(item: PlaylistItem): ParsedPlaylistItem[] {
  const url = normalizeM3uStreamUrl(item.url)
  if (!url) return []

  const requestHeaders = normalizeRequestHeaders(item.http.referrer, item.http['user-agent'], parseUrlHeaders(item.url))
  return [
    {
      title: item.name.trim() || item.tvg.name.trim() || '未命名频道',
      group: item.group.title.trim() || DEFAULT_GROUP,
      logo: item.tvg.logo.trim() || undefined,
      tvgId: item.tvg.id.trim() || undefined,
      tvgName: item.tvg.name.trim() || undefined,
      epgUrl: item.tvg.url.trim() || undefined,
      requestHeaders,
      url,
    },
  ]
}

function normalizeM3uStreamUrl(value: string): string {
  const url = value.split('|', 1)[0]?.trim() || ''
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol) ? url : ''
  } catch {
    return ''
  }
}

function normalizeRequestHeaders(
  referer: string,
  userAgent: string,
  urlHeaders: Record<string, string>,
): IptvStreamRequestHeaders | undefined {
  const headers = new Map<string, { name: string; value: string }>()
  const entries: Array<[string, string]> = [
    ...(referer.trim() ? ([['Referer', referer.trim()]] as Array<[string, string]>) : []),
    ...(userAgent.trim() ? ([['User-Agent', userAgent.trim()]] as Array<[string, string]>) : []),
    ...Object.entries(urlHeaders),
  ]
  for (const [rawName, value] of entries) {
    const normalized = rawName.trim().toLowerCase()
    const name = normalized === 'referrer' ? 'Referer' : normalized === 'useragent' ? 'User-Agent' : rawName.trim()
    if (name && value.trim()) headers.set(name.toLowerCase(), { name, value })
  }
  if (headers.size === 0) return undefined
  return { headers: Object.fromEntries([...headers.values()].map(({ name, value }) => [name, value])) }
}

function parseUrlHeaders(value: string): Record<string, string> {
  const raw = value.includes('|') ? value.slice(value.indexOf('|') + 1) : ''
  if (!raw) return {}
  return Object.fromEntries(
    raw
      .split('&')
      .map((part) => part.split('=', 2).map((item) => decodeURIComponent(item.trim())))
      .filter((entry): entry is [string, string] => entry.length === 2 && Boolean(entry[0] && entry[1])),
  )
}

function parseHeaderEpgUrls(raw: string): string[] {
  const match = /(?:url-tvg|x-tvg-url)=["']([^"']+)["']/gi
  return [...raw.matchAll(match)].map((item) => item[1] ?? '')
}

function splitEpgUrls(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return value.split(/[;,]/).map((item) => item.trim())
}

function parseTextPlaylistItems(content: string): ParsedPlaylistItem[] {
  const items: ParsedPlaylistItem[] = []
  const lines = parsePlaylistLines(content)
  let currentGroup = DEFAULT_GROUP
  let currentGenre = ''

  for (const line of lines) {
    if (line.startsWith('#')) {
      continue
    }

    const marker = parseTextGroupMarker(line)
    if (marker) {
      if (marker.type === '#group#') {
        currentGroup = marker.name
        currentGenre = ''
      } else {
        currentGenre = marker.name
      }
      continue
    }

    const streamItem = parseTextStreamItem(line)
    if (!streamItem) {
      continue
    }

    items.push({
      title: streamItem.title,
      group: currentGenre || currentGroup,
      url: streamItem.url,
    })
  }

  return items
}

function playlistItemsToText(items: ParsedPlaylistItem[]): string {
  const lines: string[] = []
  let lastGroup = ''

  for (const item of items) {
    if (item.group !== lastGroup) {
      lines.push(`${item.group},#genre#`)
      lastGroup = item.group
    }

    lines.push(`${item.title},${item.url}`)
  }

  return lines.join('\n')
}

function parsePlaylistLines(content: string): string[] {
  return content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function isM3uPlaylist(content: string): boolean {
  return parsePlaylistLines(content)[0]?.startsWith('#EXTM3U') ?? false
}

function parseTextGroupMarker(line: string): { name: string; type: '#genre#' | '#group#' } | undefined {
  const commaIndex = line.lastIndexOf(',')
  if (commaIndex < 0) {
    return undefined
  }

  const marker = line
    .slice(commaIndex + 1)
    .trim()
    .toLowerCase()
  if (!TEXT_GROUP_MARKERS.has(marker)) {
    return undefined
  }

  const groupName = line.slice(0, commaIndex).trim()
  if (!groupName) {
    return undefined
  }

  return {
    name: groupName,
    type: marker as '#genre#' | '#group#',
  }
}

function parseTextStreamItem(line: string): { title: string; url: string } | undefined {
  const urlMatch = STREAM_URL_PATTERN.exec(line)
  if (!urlMatch || urlMatch.index === undefined) {
    return undefined
  }

  const rawTitle = line.slice(0, urlMatch.index).replace(/,+$/, '').trim()
  const title = rawTitle || '未命名频道'
  const url = line.slice(urlMatch.index).trim()

  return {
    title,
    url,
  }
}

function addStream(channelMap: Map<string, IptvChannel>, info: ParsedExtInf, url: string): void {
  const channelId = createStableId(`${info.group}:${info.title}`)
  const stream: IptvChannelStream = {
    id: createStableId(`${info.group}:${info.title}:${url}`),
    name: `线路 ${((channelMap.get(channelId)?.streams.length ?? 0) + 1).toString()}`,
    url,
    ...(info.requestHeaders ? { requestHeaders: info.requestHeaders } : {}),
    isLive: inferStreamIsLive(info.group, info.title, url),
  }
  const current = channelMap.get(channelId)

  if (current) {
    if (!current.streams.some((item) => item.url === url)) {
      current.streams.push(stream)
    }
    return
  }

  channelMap.set(channelId, {
    id: channelId,
    title: info.title,
    group: info.group,
    logo: info.logo,
    tvgId: info.tvgId,
    tvgName: info.tvgName,
    epgUrl: info.epgUrl,
    streams: [stream],
  })
}

function inferStreamIsLive(group: string, title: string, url: string): boolean {
  const context = `${group} ${title}`
  if (VOD_CONTEXT_KEYWORDS.some((keyword) => context.includes(keyword))) {
    return false
  }

  if (isVodStreamUrl(url)) {
    return false
  }

  if (IPTV_CONTEXT_KEYWORDS.some((keyword) => context.includes(keyword))) {
    return true
  }

  return true
}

function isVodStreamUrl(url: string): boolean {
  return VOD_STREAM_URL_PATTERN.test(url)
}

function createStableId(input: string): string {
  let hash = 0

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index)
    hash |= 0
  }

  return Math.abs(hash).toString(36)
}
