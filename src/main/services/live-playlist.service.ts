import type { LiveChannel, LiveChannelStream, LivePlaylist } from '@shared/types'
import type { HttpClient } from './http-client'

const MAX_PLAYLIST_SIZE = 10 * 1024 * 1024
const DEFAULT_GROUP = '未分组'
const VOD_STREAM_URL_PATTERN = /\.(?:mp4|m4v|mkv|mov|avi|wmv|flv|webm)(?:$|[?#])/i

interface ParsedExtInf {
  title: string
  group: string
  logo?: string
  tvgName?: string
  epgUrl?: string
}

export class LivePlaylistService {
  constructor(private readonly httpClient: HttpClient) {}

  async load(url: string): Promise<LivePlaylist> {
    const parsedUrl = new URL(url)

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('直播源地址仅支持 HTTP 或 HTTPS')
    }

    const content = await this.httpClient.get<string>(parsedUrl.toString(), {
      responseType: 'text',
      maxContentLength: MAX_PLAYLIST_SIZE,
    })

    return parseLivePlaylist(content, parsedUrl.toString())
  }
}

export function parseLivePlaylist(content: string, sourceUrl: string): LivePlaylist {
  const lines = parseM3uLines(content)

  if (lines.length === 0 || !lines[0]?.startsWith('#EXTM3U')) {
    throw new Error('直播源不是有效的 M3U 播放列表')
  }

  const channelMap = new Map<string, LiveChannel>()
  let pendingInfo: ParsedExtInf | undefined

  for (const line of lines.slice(1)) {
    if (line.startsWith('#EXTINF:')) {
      pendingInfo = parseExtInf(line)
      continue
    }

    if (line.startsWith('#')) {
      continue
    }

    if (!pendingInfo) {
      continue
    }

    addStream(channelMap, pendingInfo, line)
    pendingInfo = undefined
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

function parseM3uLines(content: string): string[] {
  return content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
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
    isLive: !isVodStreamUrl(url),
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
