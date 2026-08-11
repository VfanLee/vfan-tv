import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { isApiAvailable, listFavorites, listRecentPlays } from '@renderer/platform/api'
import { favoriteToVodSearchResult, recentPlayToVodSearchResult } from '@renderer/platform/playback'
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

/**
 * Cmd+R / 深链进入点播页时：
 * 1. 等待 search-context 从 sessionStorage 恢复
 * 2. 若仍缺当前片，从收藏 / 最近播放按 sourceId+vodId 回填
 * 3. location.state 丢失时，用最近播放恢复选集与进度
 */
export function useVodPageHydration(
  sourceId: string | undefined,
  vodId: string | undefined,
  hasCurrentCandidate: boolean,
  locationState: PlayerLocationState | null,
): VodPageHydrationState {
  const mergeCandidates = useSearchContextStore((state) => state.mergeCandidates)
  const setContext = useSearchContextStore((state) => state.setContext)
  const keyword = useSearchContextStore((state) => state.keyword)
  // 订阅 Zustand 持久化恢复状态，并返回当前是否恢复完成。
  const storeReady = useSyncExternalStore(
    (onStoreChange) => useSearchContextStore.persist.onFinishHydration(onStoreChange),
    () => useSearchContextStore.persist.hasHydrated(),
    () => false,
  )
  const [completedHydrationKey, setCompletedHydrationKey] = useState<string>()
  const [restoredLocation, setRestoredLocation] = useState<RestoredLocationState>()
  const attemptedKeyRef = useRef<string>('')
  const hydrationKey = sourceId && vodId ? `${sourceId}:${vodId}` : undefined

  /** 从搜索上下文、收藏和最近播放恢复点播页面状态 */
  useEffect(() => {
    if (!storeReady || !sourceId || !vodId || !isApiAvailable()) return

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
        const [favorites, recentPlays] = await Promise.all([listFavorites(), listRecentPlays(50)])
        if (!active) return

        const matchedFavorite = favorites.find((item) => item.sourceId === sourceId && item.vodId === vodId)
        const matchedRecent = recentPlays.find((item) => item.sourceId === sourceId && item.vodId === vodId)

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
              initialTime: matchedRecent.currentTime > 0 ? matchedRecent.currentTime : undefined,
            },
          })
        }
      } finally {
        if (active) setCompletedHydrationKey(attemptKey)
      }
    })()

    return () => {
      active = false
    }
  }, [
    hasCurrentCandidate,
    keyword,
    locationState?.episodeUrl,
    locationState?.initialTime,
    mergeCandidates,
    setContext,
    sourceId,
    storeReady,
    vodId,
  ])

  const waitingForStore = Boolean(sourceId && vodId && !storeReady && !hasCurrentCandidate)
  const restoredLocationState =
    restoredLocation && restoredLocation.key === hydrationKey ? restoredLocation.value : null
  const isCandidateHydrationPending = Boolean(
    hydrationKey && storeReady && isApiAvailable() && !hasCurrentCandidate && completedHydrationKey !== hydrationKey,
  )

  return {
    isHydrating: waitingForStore || isCandidateHydrationPending,
    restoredLocationState: locationState ?? restoredLocationState,
  }
}
