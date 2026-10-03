import { useState } from 'react'
import type { VodSearchResult } from '@/types'
import type { EpisodeSelection, PlayerLocationState } from '../types'
import { createVodPlaybackSession, type VodPlaybackSession } from '../playback-session'

/** 仅在主动选集、换源或路由变化时更换媒体候选，后台详情不重建播放会话 */
export function useVodPlaybackSession(
  requestKey: string,
  current: VodSearchResult | undefined,
  selection: EpisodeSelection,
  locationState: PlayerLocationState | null,
  isHydrating: boolean,
): VodPlaybackSession | undefined {
  const [saved, setSaved] = useState<VodPlaybackSession>()
  if (saved?.requestKey === requestKey) return saved
  if (isHydrating || !current) return undefined
  const next = createVodPlaybackSession(requestKey, current, selection, locationState)
  if (next.candidates.length === 0) return undefined
  setSaved(next)
  return next
}
