import { useEffect, useRef, useState } from 'react'
import { isApiAvailable, listFavorites, listRecentPlays } from '@renderer/services/api'
import { favoriteToVodSearchResult, recentPlayToVodSearchResult } from '@renderer/services/playback'
import { useSearchContextStore } from '@renderer/stores/search-context'
import type { PlayerLocationState } from '../types'

interface VodPageHydrationState {
  isHydrating: boolean
  restoredLocationState: PlayerLocationState | null
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
  const [storeReady, setStoreReady] = useState(() => useSearchContextStore.persist.hasHydrated())
  const [isHydratingLocal, setIsHydratingLocal] = useState(false)
  const [restoredLocationState, setRestoredLocationState] = useState<PlayerLocationState | null>(null)
  const attemptedKeyRef = useRef<string>('')

  useEffect(() => {
    attemptedKeyRef.current = ''
    setRestoredLocationState(null)
  }, [sourceId, vodId])

  useEffect(() => {
    setStoreReady(useSearchContextStore.persist.hasHydrated())
    return useSearchContextStore.persist.onFinishHydration(() => {
      setStoreReady(true)
    })
  }, [])

  useEffect(() => {
    if (!storeReady || !sourceId || !vodId || !isApiAvailable()) {
      setIsHydratingLocal(false)
      return
    }

    const attemptKey = `${sourceId}:${vodId}`
    const needsCandidate = !hasCurrentCandidate
    const needsPlaybackState =
      !locationState?.episodeUrl && !(locationState?.initialTime && locationState.initialTime > 0)

    if (!needsCandidate && !needsPlaybackState) {
      setIsHydratingLocal(false)
      return
    }

    if (attemptedKeyRef.current === attemptKey) {
      return
    }
    attemptedKeyRef.current = attemptKey

    let active = true
    setIsHydratingLocal(needsCandidate)

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
          setRestoredLocationState({
            episodeUrl: matchedRecent.episodeUrl,
            initialTime: matchedRecent.currentTime > 0 ? matchedRecent.currentTime : undefined,
          })
        }
      } finally {
        if (active) {
          setIsHydratingLocal(false)
        }
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

  return {
    isHydrating: waitingForStore || isHydratingLocal,
    restoredLocationState: locationState ?? restoredLocationState,
  }
}
