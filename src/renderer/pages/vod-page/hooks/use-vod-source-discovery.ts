import { useCallback, useEffect, useRef, useState } from 'react'
import type { VodSearchResult } from '@shared/types'
import { cancelVodSearch, isApiAvailable, onVodSearchEvent, probeMediaSource, searchVod } from '@renderer/platform/api'
import { useSearchContextStore } from '@/stores'
import type {
  EpisodeSelection,
  PlayerLocationState,
  SourceProbeRequest,
  SourceProbeState,
  SourceRefreshState,
} from '../types'
import {
  getCandidateKey,
  getCorrespondingEpisodeUrl,
  getEpisodeCount,
  normalizeTitle,
  runWithConcurrency,
} from '../utils'

interface SourceDiscoveryOptions {
  activeSelection: EpisodeSelection
  current?: VodSearchResult
  currentTitleKey: string
  locationState: PlayerLocationState | null
  sameTitleCandidates: VodSearchResult[]
}

interface VodSourceDiscoveryState {
  isRefreshingSources: boolean
  refreshState: SourceRefreshState
  sourceProbeStates: Record<string, SourceProbeState>
  openSources: () => void
  probeSources: (items?: VodSearchResult[]) => void
  refreshSources: () => Promise<void>
}

/** 搜索当前标题的同名点播内容，并探测对应剧集的播放地址 */
export function useVodSourceDiscovery({
  activeSelection,
  current,
  currentTitleKey,
  locationState,
  sameTitleCandidates,
}: SourceDiscoveryOptions): VodSourceDiscoveryState {
  const mergeCandidates = useSearchContextStore((state) => state.mergeCandidates)
  const [isRefreshingSources, setIsRefreshingSources] = useState(false)
  const [sourceProbeStates, setSourceProbeStates] = useState<Record<string, SourceProbeState>>({})
  const [sourceProbeRequest, setSourceProbeRequest] = useState<SourceProbeRequest>()
  const [refreshState, setRefreshState] = useState<SourceRefreshState>({ found: 0, failed: 0, finished: 0 })
  const refreshSearchIdRef = useRef<string | undefined>(undefined)
  const autoRefreshedSourcesRef = useRef<Set<string>>(new Set())
  const autoHydratedTitleRef = useRef<Set<string>>(new Set())

  /** 搜索当前标题的同名点播源 */
  const refreshSources = useCallback(async (): Promise<void> => {
    if (!isApiAvailable() || !current?.title || isRefreshingSources) return
    // 取消当前补源任务，再启动新的同名内容搜索。
    if (refreshSearchIdRef.current) await cancelVodSearch(refreshSearchIdRef.current)
    setRefreshState({ found: 0, failed: 0, finished: 0 })
    setSourceProbeRequest(undefined)
    setSourceProbeStates({})
    setIsRefreshingSources(true)
    const result = await searchVod(current.title)
    if (!result) {
      setIsRefreshingSources(false)
      return
    }
    refreshSearchIdRef.current = result.searchId
  }, [current, isRefreshingSources])

  /** 探测同名点播源中对应剧集的播放地址 */
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

  /** 首次打开来源标签页时搜索同名点播源 */
  const openSources = (): void => {
    const refreshKey = `${activeSelection.resourceKey}:${currentTitleKey}`
    if (!currentTitleKey || autoRefreshedSourcesRef.current.has(refreshKey)) return
    autoRefreshedSourcesRef.current.add(refreshKey)
    if (isRefreshingSources) return
    void refreshSources()
  }

  /** 进入单集或恢复播放场景时自动搜索同名点播源 */
  useEffect(() => {
    if (!current || !isApiAvailable() || isRefreshingSources) return
    const isRestoringRecentPlayback = locationState?.episodeUrl != null
    const hydrateKey = `${current.sourceId}:${current.vodId}:${currentTitleKey}`
    if (
      (!isRestoringRecentPlayback && getEpisodeCount(current) !== 1) ||
      !currentTitleKey ||
      autoHydratedTitleRef.current.has(hydrateKey)
    )
      return
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

  /** 订阅补源搜索事件并合并同名点播结果 */
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
      }
    })
  }, [currentTitleKey, mergeCandidates])

  /** 探测候选点播源的对应剧集地址 */
  useEffect(() => {
    if (!sourceProbeRequest) return
    let active = true
    const targets = sourceProbeRequest.items.map((item) => ({
      item,
      url: getCorrespondingEpisodeUrl(item, sourceProbeRequest.lineIndex, sourceProbeRequest.episodeIndex),
    }))
    // 按固定并发数探测候选剧集的媒体地址。
    void runWithConcurrency(targets, 4, async ({ item, url }) => {
      const result = url ? await probeMediaSource({ url, sourceId: item.sourceId }) : undefined
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

  /** 组件卸载或标题变化时取消补源搜索 */
  useEffect(() => {
    return () => {
      if (refreshSearchIdRef.current) void cancelVodSearch(refreshSearchIdRef.current)
    }
  }, [currentTitleKey])

  return { isRefreshingSources, sourceProbeStates, refreshState, openSources, probeSources, refreshSources }
}
