import type { IptvPlaybackTarget, IptvPlaylist } from '@shared/types'
import { requireRuntimeApi } from './client'

export async function getIptvCatalog(sourceId: string, force = false): Promise<IptvPlaylist> {
  return requireRuntimeApi().iptv.getCatalog(sourceId, force)
}

export async function getIptvPlaybackTarget(
  sourceId: string,
  channelId: string,
  streamId: string,
): Promise<IptvPlaybackTarget> {
  return requireRuntimeApi().iptv.getPlaybackTarget(sourceId, channelId, streamId)
}
