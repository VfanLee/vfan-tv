import {
  LIVE_PLAYLIST_CACHE_PREFIX,
  LIVE_SELECTED_SOURCE_STORAGE_KEY,
  LIVE_SELECTION_STORAGE_PREFIX,
} from '@shared/constants'
import type { LiveChannel, LivePlaylist, LiveSourceConfig, MediaStreamType } from '@shared/types'
import type { LiveSelectionCache } from './types'

const LIVE_CONTEXT_KEYWORDS = ['直播', '卫视', '央视', '央卫视']
const VOD_CONTEXT_KEYWORDS = ['点播', '录播', '回放']

export function groupChannels(
  channels: LiveChannel[],
  keyword: string,
): Array<{ name: string; channels: LiveChannel[] }> {
  const normalizedKeyword = keyword.trim().toLowerCase()
  const groupMap = new Map<string, LiveChannel[]>()
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

export function readCachedPlaylist(source: LiveSourceConfig): LivePlaylist | undefined {
  try {
    const rawValue = window.localStorage.getItem(`${LIVE_PLAYLIST_CACHE_PREFIX}${source.id}`)
    if (!rawValue) return undefined
    const cachedPlaylist = JSON.parse(rawValue) as LivePlaylist
    if (cachedPlaylist.sourceUrl !== source.url || !Array.isArray(cachedPlaylist.channels)) return undefined
    return normalizeLivePlaylist(cachedPlaylist)
  } catch {
    return undefined
  }
}

export function writeCachedPlaylist(source: LiveSourceConfig, playlist: LivePlaylist): void {
  try {
    window.localStorage.setItem(`${LIVE_PLAYLIST_CACHE_PREFIX}${source.id}`, JSON.stringify(playlist))
    window.localStorage.setItem(LIVE_SELECTED_SOURCE_STORAGE_KEY, source.id)
  } catch {
    // Playback still works when storage is unavailable.
  }
}

export function readCachedSelection(sourceId: string): LiveSelectionCache | undefined {
  try {
    const rawValue = window.localStorage.getItem(`${LIVE_SELECTION_STORAGE_PREFIX}${sourceId}`)
    if (!rawValue) return undefined
    const cached = JSON.parse(rawValue) as LiveSelectionCache
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

export function writeCachedSelection(sourceId: string, selection: LiveSelectionCache): void {
  try {
    window.localStorage.setItem(`${LIVE_SELECTION_STORAGE_PREFIX}${sourceId}`, JSON.stringify(selection))
  } catch {
    // Playback still works when storage is unavailable.
  }
}

export function resolveLiveSelection(playlist: LivePlaylist, cached?: LiveSelectionCache): LiveSelectionCache {
  const firstChannel = playlist.channels[0]
  const fallback: LiveSelectionCache = {
    channelId: firstChannel?.id ?? '',
    streamId: firstChannel?.streams[0]?.id ?? '',
    expandedGroups: firstChannel?.group ? [firstChannel.group] : [],
  }
  if (!cached) return fallback
  const channel = playlist.channels.find((item) => item.id === cached.channelId) ?? firstChannel
  if (!channel) return fallback
  const stream = channel.streams.find((item) => item.id === cached.streamId) ?? channel.streams[0]
  const knownGroups = new Set(playlist.channels.map((item) => item.group))
  const expandedGroups = cached.expandedGroups.filter((group) => knownGroups.has(group))
  return {
    channelId: channel.id,
    streamId: stream?.id ?? '',
    expandedGroups:
      expandedGroups.length > 0
        ? expandedGroups.includes(channel.group)
          ? expandedGroups
          : [...expandedGroups, channel.group]
        : [channel.group],
  }
}

export function normalizeLivePlaylist(playlist: LivePlaylist): LivePlaylist {
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

export function resolveStreamPlaybackUrl(proxyBaseUrl: string, url: string | undefined): string | undefined {
  if (!url) return undefined
  if (!proxyBaseUrl) return url
  try {
    const targetUrl = new URL(url)
    if (!['http:', 'https:'].includes(targetUrl.protocol)) return url
    const proxyUrl = new URL('/media', proxyBaseUrl)
    proxyUrl.searchParams.set('url', targetUrl.toString())
    proxyUrl.searchParams.set('referer', `${targetUrl.origin}/`)
    return proxyUrl.toString()
  } catch {
    return url
  }
}

function inferStreamIsLive(group: string, title: string, url: string): boolean {
  const context = `${group} ${title}`
  if (VOD_CONTEXT_KEYWORDS.some((keyword) => context.includes(keyword))) return false
  if (/\.(?:mp4|m4v|mkv|mov|avi|wmv|webm)(?:$|[?#])/i.test(url)) return false
  if (LIVE_CONTEXT_KEYWORDS.some((keyword) => context.includes(keyword))) return true
  return true
}

export function isLikelyHlsStream(url: string | undefined): boolean {
  return getKnownStreamType(url) === 'hls'
}

export function isLikelyFlvStream(url: string | undefined): boolean {
  return getKnownStreamType(url) === 'flv'
}

export function getKnownStreamType(url: string | undefined): Exclude<MediaStreamType, 'native'> | undefined {
  if (!url) return undefined
  try {
    const parsedUrl = new URL(url)
    if (/\.m3u8(?:$|[?#])/i.test(parsedUrl.pathname) || /(?:^|[/?&=])(?:m3u8|hls|iptv|tvod)(?:$|[/?&=])/i.test(url)) {
      return 'hls'
    }
    if (
      /\.flv(?:$|[?#])/i.test(parsedUrl.pathname) ||
      (parsedUrl.hostname === 'yg.ygbox.de5.net' &&
        parsedUrl.pathname === '/huya.php' &&
        parsedUrl.searchParams.has('id'))
    ) {
      return 'flv'
    }
    if (/\.(?:ts|m2ts)(?:$|[?#])/i.test(parsedUrl.pathname)) return 'mpegts'
  } catch {
    if (/\.m3u8(?:$|[?#])/i.test(url) || /(?:^|[/?&=])(?:m3u8|hls|iptv|tvod)(?:$|[/?&=])/i.test(url)) return 'hls'
    if (/\.flv(?:$|[?#])/i.test(url) || /(?:^|\.)yg\.ygbox\.de5\.net\/huya\.php\?/i.test(url)) return 'flv'
    if (/\.(?:ts|m2ts)(?:$|[?#])/i.test(url)) return 'mpegts'
  }

  return undefined
}
