import { useRef } from 'react'
import type { RefObject } from 'react'
import type { PlayLine, VodSearchResult } from '@shared/types'
import { isApiAvailable, upsertRecentPlay } from '@renderer/services/api'
import { createRecentPlayInput } from '../utils'

interface RecentPlaybackState {
  progressRef: RefObject<{ currentTime: number; duration: number }>
  save: (progress: { currentTime: number; duration: number; force?: boolean }) => Promise<void>
}

export function useRecentPlayback(
  current: VodSearchResult | undefined,
  activeLine: PlayLine | undefined,
  activeEpisode: PlayLine['episodes'][number] | undefined,
): RecentPlaybackState {
  const lastSaveRef = useRef(0)
  const progressRef = useRef({ currentTime: 0, duration: 0 })

  const save = async ({
    currentTime,
    duration,
    force = false,
  }: {
    currentTime: number
    duration: number
    force?: boolean
  }): Promise<void> => {
    progressRef.current = { currentTime, duration }
    if (!current || !activeLine || !activeEpisode || !isApiAvailable()) return
    const now = Date.now()
    if (!force && now - lastSaveRef.current < 5000 && currentTime > 0 && currentTime < duration) return
    lastSaveRef.current = now
    await upsertRecentPlay(
      createRecentPlayInput(current, activeLine.name, activeEpisode.name, activeEpisode.url, { currentTime, duration }),
    )
  }

  return { progressRef, save }
}
