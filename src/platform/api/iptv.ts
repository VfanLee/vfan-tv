import { invoke } from '@tauri-apps/api/core'
import { isDesktopRuntime } from '../tauri'
import type { IptvPlaybackTarget, IptvPlaylist } from '@/types'

/** 读取或刷新直播目录 */
export async function getIptvCatalog(sourceId: string, force = false): Promise<IptvPlaylist> {
  if (isDesktopRuntime()) return invoke('get_iptv_catalog', { sourceId, force })
  throw new Error('当前运行环境不支持此操作')
}

/** 使用直播网络配置解析频道线路 */
export async function getIptvPlaybackTarget(
  sourceId: string,
  channelId: string,
  streamId: string,
): Promise<IptvPlaybackTarget> {
  if (isDesktopRuntime()) return invoke('get_iptv_playback_target', { sourceId, channelId, streamId })
  throw new Error('当前运行环境不支持此操作')
}
