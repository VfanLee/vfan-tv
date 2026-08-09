import {
  IPTV_PLAYLIST_CACHE_PREFIX,
  IPTV_SELECTED_SOURCE_STORAGE_KEY,
  IPTV_SELECTION_STORAGE_PREFIX,
} from '@shared/constants'
import type { IptvChannel, IptvPlaylist, IptvSourceConfig } from '@shared/types'
import type { IptvSelectionCache } from './types'

const IPTV_CONTEXT_KEYWORDS = ['直播', '卫视', '央视', '央卫视']
const VOD_CONTEXT_KEYWORDS = ['点播', '录播', '回放', '春晚']

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

export function writeCachedPlaylist(source: IptvSourceConfig, playlist: IptvPlaylist): void {
  try {
    window.localStorage.setItem(`${IPTV_PLAYLIST_CACHE_PREFIX}${source.id}`, JSON.stringify(playlist))
    window.localStorage.setItem(IPTV_SELECTED_SOURCE_STORAGE_KEY, source.id)
  } catch {
    // Playback still works when storage is unavailable.
  }
}

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

export function writeCachedSelection(sourceId: string, selection: IptvSelectionCache): void {
  try {
    window.localStorage.setItem(`${IPTV_SELECTION_STORAGE_PREFIX}${sourceId}`, JSON.stringify(selection))
  } catch {
    // Playback still works when storage is unavailable.
  }
}

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

function inferStreamIsLive(group: string, title: string, url: string): boolean {
  const context = `${group} ${title}`
  if (VOD_CONTEXT_KEYWORDS.some((keyword) => context.includes(keyword))) return false
  if (/\.(?:mp4|m4v|mkv|mov|avi|wmv|webm)(?:$|[?#])/i.test(url)) return false
  if (IPTV_CONTEXT_KEYWORDS.some((keyword) => context.includes(keyword))) return true
  return true
}
