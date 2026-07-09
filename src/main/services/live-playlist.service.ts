import type { LiveChannel, LiveChannelStream, LivePlaylist } from '@shared/types'
import type { HttpClient } from './http-client'

const MAX_PLAYLIST_SIZE = 10 * 1024 * 1024
const DEFAULT_GROUP = '未分组'
const VOD_STREAM_URL_PATTERN = /\.(?:mp4|m4v|mkv|mov|avi|wmv|webm)(?:$|[?#])/i
const STREAM_URL_PATTERN = /(?:https?|rtmp|rtsp):\/\/\S+/i
const TEXT_GROUP_MARKERS = new Set(['#genre#', '#group#'])
const LIVE_CONTEXT_KEYWORDS = ['直播', '卫视', '央视', '央卫视']
const VOD_CONTEXT_KEYWORDS = ['点播', '录播', '回放']

interface ParsedExtInf {
  title: string
  group: string
  logo?: string
  tvgName?: string
  epgUrl?: string
}

interface ParsedPlaylistItem extends ParsedExtInf {
  url: string
}

export class LivePlaylistService {
  constructor(private readonly httpClient: HttpClient) {}

  async load(url: string): Promise<LivePlaylist> {
    const parsedUrl = new URL(url)

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('直播源地址仅支持 HTTP 或 HTTPS')
    }

    const playlistResponse = await this.loadPlaylistContent(parsedUrl)

    return parseLivePlaylist(playlistResponse.content, playlistResponse.url)
  }

  private async loadPlaylistContent(parsedUrl: URL): Promise<{ content: string; url: string }> {
    try {
      return {
        content: await this.httpClient.get<string>(parsedUrl.toString(), {
          responseType: 'text',
          maxContentLength: MAX_PLAYLIST_SIZE,
        }),
        url: parsedUrl.toString(),
      }
    } catch (error) {
      if (parsedUrl.protocol !== 'https:') {
        throw error
      }

      const fallbackUrl = new URL(parsedUrl)
      fallbackUrl.protocol = 'http:'
      return {
        content: await this.httpClient.get<string>(fallbackUrl.toString(), {
          responseType: 'text',
          maxContentLength: MAX_PLAYLIST_SIZE,
        }),
        url: fallbackUrl.toString(),
      }
    }
  }
}

export function parseLivePlaylist(content: string, sourceUrl: string): LivePlaylist {
  const items = parsePlaylistItems(content)
  const channelMap = new Map<string, LiveChannel>()

  for (const item of items) {
    addStream(channelMap, item, item.url)
  }

  const channels = [...channelMap.values()]

  if (channels.length === 0) {
    throw new Error('直播源中没有可播放频道')
  }

  return {
    sourceUrl,
    fetchedAt: Date.now(),
    channels,
  }
}

export function m3uToTextPlaylist(content: string): string {
  if (!isM3uPlaylist(content)) {
    return content
  }

  return playlistItemsToText(parseM3uPlaylistItems(content))
}

function parsePlaylistItems(content: string): ParsedPlaylistItem[] {
  return isM3uPlaylist(content) ? parseM3uPlaylistItems(content) : parseTextPlaylistItems(content)
}

function parseM3uPlaylistItems(content: string): ParsedPlaylistItem[] {
  const lines = parsePlaylistLines(content)
  const items: ParsedPlaylistItem[] = []
  let pendingInfo: ParsedExtInf | undefined

  for (const line of lines.slice(1)) {
    if (line.startsWith('#EXTINF:')) {
      pendingInfo = parseExtInf(line)
      continue
    }

    if (line.startsWith('#EXTGRP:')) {
      if (pendingInfo) {
        const group = line.slice('#EXTGRP:'.length).trim()
        pendingInfo = {
          ...pendingInfo,
          group: group || pendingInfo.group,
        }
      }
      continue
    }

    if (line.startsWith('#')) {
      continue
    }

    if (!pendingInfo) {
      continue
    }

    items.push({
      ...pendingInfo,
      url: line,
    })
    pendingInfo = undefined
  }

  return items
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

function parseExtInf(line: string): ParsedExtInf {
  const commaIndex = line.indexOf(',')
  const metadata = commaIndex >= 0 ? line.slice(0, commaIndex) : line
  const displayName = commaIndex >= 0 ? line.slice(commaIndex + 1).trim() : ''
  const attributes = parseAttributes(metadata)
  const tvgName = attributes['tvg-name']?.trim()
  const title = displayName || tvgName || '未命名频道'

  return {
    title,
    group: attributes['group-title']?.trim() || DEFAULT_GROUP,
    logo: attributes['tvg-logo']?.trim() || undefined,
    tvgName: tvgName || undefined,
    epgUrl: attributes['epg-url']?.trim() || undefined,
  }
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

function parseAttributes(input: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const pattern = /([\w-]+)="([^"]*)"/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(input)) !== null) {
    attributes[match[1]] = match[2]
  }

  return attributes
}

function addStream(channelMap: Map<string, LiveChannel>, info: ParsedExtInf, url: string): void {
  const channelId = createStableId(`${info.group}:${info.title}`)
  const stream: LiveChannelStream = {
    id: createStableId(`${info.group}:${info.title}:${url}`),
    name: `线路 ${((channelMap.get(channelId)?.streams.length ?? 0) + 1).toString()}`,
    url,
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

  if (LIVE_CONTEXT_KEYWORDS.some((keyword) => context.includes(keyword))) {
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
