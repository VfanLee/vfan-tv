import { useCallback, useEffect, useRef, useState } from 'react'
import type { VodSearchResult } from '@shared/types'
import { cancelVodSearch, isApiAvailable, onVodSearchEvent, probeMediaSource, searchVod } from '@renderer/services/api'
import { useSearchContextStore } from '@/stores'
import type {
  EpisodeSelection,
  PlayerLocationState,
  SourceProbeRequest,
  SourceProbeState,
  SourceRefreshState,
} from '../types'
import {
  dedupeCandidates,
  getCandidateKey,
  getCorrespondingEpisodeUrl,
  getEpisodeCount,
  normalizeTitle,
  runWithConcurrency,
} from '../utils'

// 当前片源不可用时的补源与测速流程：搜索事件先合并候选，再按有限并发探测对应剧集。
interface SourceDiscoveryOptions {
  activeSelection: EpisodeSelection
  current?: VodSearchResult
  currentTitleKey: string
  locationState: PlayerLocationState | null
  sameTitleCandidates: VodSearchResult[]
  sourceRows: Array<{ item: VodSearchResult; count: number; isActive: boolean }>
}

interface VodSourceDiscoveryState {
  isRefreshingSources: boolean
  refreshState: SourceRefreshState
  sourceProbeStates: Record<string, SourceProbeState>
  openSources: () => void
  probeSources: (items?: VodSearchResult[]) => void
  refreshSources: (shouldProbe?: boolean) => Promise<void>
}

export function useVodSourceDiscovery({
  activeSelection,
  current,
  currentTitleKey,
  locationState,
  sameTitleCandidates,
  sourceRows,
}: SourceDiscoveryOptions): VodSourceDiscoveryState {
  const mergeCandidates = useSearchContextStore((state) => state.mergeCandidates)
  const [isRefreshingSources, setIsRefreshingSources] = useState(false)
  const [sourceProbeStates, setSourceProbeStates] = useState<Record<string, SourceProbeState>>({})
  const [sourceProbeRequest, setSourceProbeRequest] = useState<SourceProbeRequest>()
  const [refreshState, setRefreshState] = useState<SourceRefreshState>({ found: 0, failed: 0, finished: 0 })
  const refreshSearchIdRef = useRef<string | undefined>(undefined)
  const probeAfterRefreshRef = useRef(false)
  const autoRefreshedSourcesRef = useRef<Set<string>>(new Set())
  const autoHydratedTitleRef = useRef<Set<string>>(new Set())

  const refreshSources = useCallback(
    async (shouldProbe = false): Promise<void> => {
      if (!isApiAvailable() || !current?.title || isRefreshingSources) return
      // 同一页面只允许一个补源搜索，先取消旧任务以免事件混入新结果。
      if (refreshSearchIdRef.current) await cancelVodSearch(refreshSearchIdRef.current)
      setRefreshState({ found: 0, failed: 0, finished: 0 })
      setSourceProbeRequest(undefined)
      setSourceProbeStates({})
      probeAfterRefreshRef.current = shouldProbe
      if (shouldProbe) {
        setSourceProbeStates(
          Object.fromEntries(sourceRows.map(({ item }) => [getCandidateKey(item), { status: 'loading' as const }])),
        )
      }
      setIsRefreshingSources(true)
      const result = await searchVod(current.title)
      if (!result) {
        probeAfterRefreshRef.current = false
        setIsRefreshingSources(false)
        if (shouldProbe) setSourceProbeStates({})
        return
      }
      refreshSearchIdRef.current = result.searchId
    },
    [current, isRefreshingSources, sourceRows],
  )

  const probeSources = useCallback(
    (items = sameTitleCandidates): void => {
      if (items.length === 0) {
        setSourceProbeRequest(undefined)
        setSourceProbeStates({})
        return
      }
      setSourceProbeStates(
        Object.fromEntries(items.map((item) => [getCandidateKey(item), { status: 'loading' as const }])),
      )
      setSourceProbeRequest({
        items,
        lineIndex: activeSelection.lineIndex,
        episodeIndex: activeSelection.episodeIndex,
      })
    },
    [activeSelection.episodeIndex, activeSelection.lineIndex, sameTitleCandidates],
  )

  const openSources = (): void => {
    const refreshKey = `${activeSelection.resourceKey}:${currentTitleKey}`
    if (!currentTitleKey || autoRefreshedSourcesRef.current.has(refreshKey)) return
    autoRefreshedSourcesRef.current.add(refreshKey)
    if (isRefreshingSources) {
      probeAfterRefreshRef.current = true
      setSourceProbeStates(
        Object.fromEntries(sourceRows.map(({ item }) => [getCandidateKey(item), { status: 'loading' as const }])),
      )
      return
    }
    void refreshSources(true)
  }

  useEffect(() => {
    if (!current || !isApiAvailable() || isRefreshingSources) return
    if (locationState?.episodeUrl != null || (locationState?.initialTime ?? 0) > 0) return
    const hydrateKey = `${current.sourceId}:${current.vodId}:${currentTitleKey}`
    if (getEpisodeCount(current) !== 1 || !currentTitleKey || autoHydratedTitleRef.current.has(hydrateKey)) return
    autoHydratedTitleRef.current.add(hydrateKey)
    void refreshSources()
  }, [
    current,
    currentTitleKey,
    isRefreshingSources,
    locationState?.episodeUrl,
    locationState?.initialTime,
    refreshSources,
  ])

  useEffect(() => {
    return onVodSearchEvent((event) => {
      if (event.searchId !== refreshSearchIdRef.current) return
      if (event.type === 'source-result') {
        const matchedItems = event.items.filter((item) => normalizeTitle(item.title) === currentTitleKey)
        if (matchedItems.length > 0) {
          mergeCandidates(matchedItems)
          setRefreshState((state) => ({
            ...state,
            found: state.found + matchedItems.length,
            finished: state.finished + 1,
          }))
          return
        }
        setRefreshState((state) => ({ ...state, finished: state.finished + 1 }))
        return
      }
      if (event.type === 'source-error' || event.type === 'source-timeout' || event.type === 'source-cancelled') {
        setRefreshState((state) => ({ ...state, failed: state.failed + 1, finished: state.finished + 1 }))
        return
      }
      if (event.type === 'done') {
        refreshSearchIdRef.current = undefined
        setIsRefreshingSources(false)
        if (probeAfterRefreshRef.current) {
          probeAfterRefreshRef.current = false
          const latestItems = dedupeCandidates(
            useSearchContextStore
              .getState()
              .candidates.filter((item) => normalizeTitle(item.title) === currentTitleKey),
          )
          setSourceProbeStates(
            Object.fromEntries(latestItems.map((item) => [getCandidateKey(item), { status: 'loading' as const }])),
          )
          setSourceProbeRequest({
            items: latestItems,
            lineIndex: activeSelection.lineIndex,
            episodeIndex: activeSelection.episodeIndex,
          })
        }
      }
    })
  }, [activeSelection.episodeIndex, activeSelection.lineIndex, currentTitleKey, mergeCandidates])

  useEffect(() => {
    if (!sourceProbeRequest) return
    let active = true
    const targets = sourceProbeRequest.items.map((item) => ({
      item,
      url: getCorrespondingEpisodeUrl(item, sourceProbeRequest.lineIndex, sourceProbeRequest.episodeIndex),
    }))
    // 探测会触发真实媒体请求，限制并发以降低对源站和本地代理的压力。
    void runWithConcurrency(targets, 4, async ({ item, url }) => {
      const result = url ? await probeMediaSource({ url, referer: item.sourceUrl }) : undefined
      if (!active) return
      setSourceProbeStates((states) => ({
        ...states,
        [getCandidateKey(item)]: {
          status: 'complete',
          latencyMs: result?.latencyMs ?? null,
          quality: result?.quality ?? null,
        },
      }))
    })
    return () => {
      active = false
    }
  }, [sourceProbeRequest])

  useEffect(() => {
    return () => {
      if (refreshSearchIdRef.current) void cancelVodSearch(refreshSearchIdRef.current)
    }
  }, [currentTitleKey])

  return { isRefreshingSources, sourceProbeStates, refreshState, openSources, probeSources, refreshSources }
}
