import type { LivePlaylist } from '@shared/types'
import { requireRuntimeApi } from './client'

export async function loadLivePlaylist(url: string): Promise<LivePlaylist> {
  return requireRuntimeApi().live.loadPlaylist(url)
}
