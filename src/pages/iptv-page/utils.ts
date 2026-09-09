import { useUiPreferencesStore } from '@/stores'
import type { IptvChannel, IptvPlaylist, IptvSourceConfig } from '@/types'
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

/** 当前窗口中的直播列表缓存，关闭窗口后释放 */
const playlistCache = new Map<string, IptvPlaylist>()

/** 读取源地址仍匹配的内存播放列表 */
export function readCachedPlaylist(source: IptvSourceConfig): IptvPlaylist | undefined {
  const playlist = playlistCache.get(source.id)
  return playlist?.sourceUrl === source.url ? structuredClone(playlist) : undefined
}

/** 保存当前窗口的播放列表缓存 */
export function writeCachedPlaylist(source: IptvSourceConfig, playlist: IptvPlaylist): void {
  playlistCache.set(source.id, normalizeIptvPlaylist(structuredClone(playlist)))
}

/** 清理直播列表内存缓存 */
export function clearIptvPlaylistCache(): void {
  playlistCache.clear()
}

/** 读取启动时从数据库加载的频道选择 */
export function readCachedSelection(sourceId: string): IptvSelectionCache | undefined {
  const selection = useUiPreferencesStore.getState().iptvSelections[sourceId]
  return selection ? structuredClone(selection) : undefined
}

/** 将成功播放的频道选择写入数据库 */
export function writeCachedSelection(sourceId: string, selection: IptvSelectionCache): void {
  useUiPreferencesStore.getState().setIptvSelection(sourceId, selection)
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
