import {
  IPTV_PLAYLIST_CACHE_PREFIX,
  IPTV_SELECTED_SOURCE_STORAGE_KEY,
  IPTV_SELECTION_STORAGE_PREFIX,
} from '@shared/constants'
import type { IptvChannel, IptvPlaylist, IptvSourceConfig } from '@shared/types'
import type { IptvSelectionCache } from './types'

/** 识别 IPTV 直播上下文的关键词 */
const IPTV_CONTEXT_KEYWORDS = ['直播', '卫视', '央视', '央卫视']
/** 排除点播上下文的关键词 */
const VOD_CONTEXT_KEYWORDS = ['点播', '录播', '回放', '春晚']

/** 按规则分组频道 */
export function groupChannels(
  channels: IptvChannel[],
  keyword: string,
): Array<{ name: string; channels: IptvChannel[] }> {
  const normalizedKeyword = keyword.trim().toLowerCase()
  const groupMap = new Map<string, IptvChannel[]>()
  for (const channel of channels) {
    if (
      normalizedKeyword &&
      !channel.title.toLowerCase().includes(normalizedKeyword) &&
      !channel.group.toLowerCase().includes(normalizedKeyword)
    ) {
      continue
    }
    const items = groupMap.get(channel.group) ?? []
    items.push(channel)
    groupMap.set(channel.group, items)
  }
  return [...groupMap.entries()].map(([name, channels]) => ({ name, channels }))
}

/** 读取缓存的播放列表 */
export function readCachedPlaylist(source: IptvSourceConfig): IptvPlaylist | undefined {
  try {
    const rawValue = window.localStorage.getItem(`${IPTV_PLAYLIST_CACHE_PREFIX}${source.id}`)
    if (!rawValue) return undefined
    const cachedPlaylist = JSON.parse(rawValue) as IptvPlaylist
    if (cachedPlaylist.sourceUrl !== source.url || !Array.isArray(cachedPlaylist.channels)) return undefined
    return normalizeIptvPlaylist(cachedPlaylist)
  } catch {
    return undefined
  }
}

/** 保存缓存的播放列表 */
export function writeCachedPlaylist(source: IptvSourceConfig, playlist: IptvPlaylist): void {
  try {
    window.localStorage.setItem(`${IPTV_PLAYLIST_CACHE_PREFIX}${source.id}`, JSON.stringify(playlist))
    window.localStorage.setItem(IPTV_SELECTED_SOURCE_STORAGE_KEY, source.id)
  } catch {
    // 忽略本地播放列表缓存写入失败。
  }
}

/** 读取缓存的选择状态 */
export function readCachedSelection(sourceId: string): IptvSelectionCache | undefined {
  try {
    const rawValue = window.localStorage.getItem(`${IPTV_SELECTION_STORAGE_PREFIX}${sourceId}`)
    if (!rawValue) return undefined
    const cached = JSON.parse(rawValue) as IptvSelectionCache
    if (
      typeof cached.channelId !== 'string' ||
      typeof cached.streamId !== 'string' ||
      !Array.isArray(cached.expandedGroups)
    ) {
      return undefined
    }
    return cached
  } catch {
    return undefined
  }
}

/** 保存缓存的选择状态 */
export function writeCachedSelection(sourceId: string, selection: IptvSelectionCache): void {
  try {
    window.localStorage.setItem(`${IPTV_SELECTION_STORAGE_PREFIX}${sourceId}`, JSON.stringify(selection))
  } catch {
    // 忽略本地频道选择缓存写入失败。
  }
}

/** 根据缓存状态解析当前 IPTV 源和频道选择 */
export function resolveIptvSelection(playlist: IptvPlaylist, cached?: IptvSelectionCache): IptvSelectionCache {
  const firstChannel = playlist.channels[0]
  const fallback: IptvSelectionCache = {
    channelId: firstChannel?.id ?? '',
    streamId: firstChannel?.streams[0]?.id ?? '',
    expandedGroups: firstChannel?.group ? [firstChannel.group] : [],
  }
  if (!cached) return fallback
  const channel = playlist.channels.find((item) => item.id === cached.channelId) ?? firstChannel
  if (!channel) return fallback
  const stream = channel.streams.find((item) => item.id === cached.streamId) ?? channel.streams[0]
  return {
    channelId: channel.id,
    streamId: stream?.id ?? '',
    expandedGroups: [channel.group],
  }
}

/** 规范化 IPTV 播放列表 */
export function normalizeIptvPlaylist(playlist: IptvPlaylist): IptvPlaylist {
  return {
    ...playlist,
    channels: playlist.channels.map((channel) => ({
      ...channel,
      streams: channel.streams.map((stream) => ({
        ...stream,
        isLive: inferStreamIsLive(channel.group, channel.title, stream.url),
      })),
    })),
  }
}

/** 结合流类型和业务上下文推断是否为直播流 */
function inferStreamIsLive(group: string, title: string, url: string): boolean {
  const context = `${group} ${title}`
  if (VOD_CONTEXT_KEYWORDS.some((keyword) => context.includes(keyword))) return false
  if (/\.(?:mp4|m4v|mkv|mov|avi|wmv|webm)(?:$|[?#])/i.test(url)) return false
  if (IPTV_CONTEXT_KEYWORDS.some((keyword) => context.includes(keyword))) return true
  return true
}
