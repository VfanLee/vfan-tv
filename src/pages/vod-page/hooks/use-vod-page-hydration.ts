import { isDesktopRuntime } from '@/platform/tauri'
import { useEffect, useRef, useState } from 'react'
import { getRecentPlay, isApiAvailable, listFavorites } from '@/platform/api'
import { favoriteToVodSearchResult, recentPlayToVodSearchResult } from '@/platform/playback'
import { useSearchContextStore } from '@/stores'
import type { PlayerLocationState } from '../types'

interface VodPageHydrationState {
  isHydrating: boolean
  restoredLocationState: PlayerLocationState | null
}

interface RestoredLocationState {
  key: string
  value: PlayerLocationState
}

/** 从数据库中的收藏和最近播放恢复刷新后的候选、选集与进度 */
export function useVodPageHydration(
  sourceId: string | undefined,
  vodId: string | undefined,
  hasCurrentCandidate: boolean,
  locationState: PlayerLocationState | null,
): VodPageHydrationState {
  const mergeCandidates = useSearchContextStore((state) => state.mergeCandidates)
  const setContext = useSearchContextStore((state) => state.setContext)
  const keyword = useSearchContextStore((state) => state.keyword)
  const apiAvailable = isDesktopRuntime() || isApiAvailable()
  const [completedHydrationKey, setCompletedHydrationKey] = useState<string>()
  const [restoredLocation, setRestoredLocation] = useState<RestoredLocationState>()
  const attemptedKeyRef = useRef<string>('')
  const hydrationKey = sourceId && vodId ? `${sourceId}:${vodId}` : undefined

  /** 从搜索上下文、收藏和最近播放恢复点播页面状态 */
  useEffect(() => {
    if (!sourceId || !vodId || !apiAvailable) return

    const attemptKey = `${sourceId}:${vodId}`
    const needsCandidate = !hasCurrentCandidate
    const needsPlaybackState =
      !locationState?.episodeUrl && !(locationState?.initialTime && locationState.initialTime > 0)

    if (!needsCandidate && !needsPlaybackState) return

    if (attemptedKeyRef.current === attemptKey) {
      return
    }
    attemptedKeyRef.current = attemptKey

    let active = true
    void (async () => {
      try {
        const [favorites, matchedRecent] = await Promise.all([listFavorites(), getRecentPlay(sourceId, vodId)])
        if (!active) return

        const matchedFavorite = favorites.find((item) => item.sourceId === sourceId && item.vodId === vodId)

        if (needsCandidate) {
          if (matchedFavorite) {
            const candidate = favoriteToVodSearchResult(matchedFavorite)
            if (keyword) {
              mergeCandidates([candidate])
            } else {
              setContext(candidate.title, [candidate])
            }
          } else if (matchedRecent) {
            const candidate = recentPlayToVodSearchResult(matchedRecent)
            if (keyword) {
              mergeCandidates([candidate])
            } else {
              setContext(candidate.title, [candidate])
            }
          }
        }

        if (needsPlaybackState && matchedRecent) {
          setRestoredLocation({
            key: attemptKey,
            value: {
              episodeUrl: matchedRecent.episodeUrl,
              initialTime: matchedRecent.positionSeconds > 0 ? matchedRecent.positionSeconds : undefined,
            },
          })
        }
      } catch (error) {
        if (active) console.error('恢复播放记录失败', error)
      } finally {
        if (active) setCompletedHydrationKey(attemptKey)
      }
    })()

    return () => {
      active = false
      if (attemptedKeyRef.current === attemptKey) attemptedKeyRef.current = ''
    }
  }, [
    hasCurrentCandidate,
    keyword,
    locationState?.episodeUrl,
    locationState?.initialTime,
    mergeCandidates,
    setContext,
    sourceId,
    apiAvailable,
    vodId,
  ])

  const restoredLocationState =
    restoredLocation && restoredLocation.key === hydrationKey ? restoredLocation.value : null
  const isCandidateHydrationPending = Boolean(
    hydrationKey && apiAvailable && !hasCurrentCandidate && completedHydrationKey !== hydrationKey,
  )

  return {
    isHydrating: isCandidateHydrationPending,
    restoredLocationState: locationState ?? restoredLocationState,
  }
}
