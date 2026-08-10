import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SEARCH_HISTORY_STORAGE_KEY, SEARCH_VIEW_MODE_STORAGE_KEY } from '@shared/constants'
import type { VodSearchResult } from '@shared/types'
import {
  cancelVodSearch,
  isApiAvailable,
  listSources,
  onAppDataChange,
  onVodSearchEvent,
  searchVod,
} from '@renderer/platform/api'
import type { GroupedSearchResult, ResultViewMode, SearchSourceStats, SourceSearchState } from '../types'
import {
  getSourceStats,
  groupSearchResults,
  loadHistories,
  loadViewMode,
  moveToHistoryTop,
  reduceSearchEvent,
  saveHistories,
} from '../utils'

// 搜索页维护单个活动搜索 ID，并将 main 推送的增量事件归约为可渲染的源状态。
export interface VodSearchState {
  allItems: VodSearchResult[]
  groupedResults: GroupedSearchResult[]
  hasAvailableSources: boolean
  hasSearched: boolean
  histories: string[]
  isSearching: boolean
  isSourcesReady: boolean
  keyword: string
  searchId?: string
  sourceList: SourceSearchState[]
  stats: SearchSourceStats
  viewMode: ResultViewMode
  cancelSearch: () => Promise<void>
  changeViewMode: (viewMode: ResultViewMode) => void
  removeHistory: (history: string) => void
  clearHistories: () => void
}

export function useVodSearch(initialKeyword: string): VodSearchState {
  const lastUrlKeywordRef = useRef('')
  const activeSearchIdRef = useRef<string | undefined>(undefined)
  const [keyword, setKeyword] = useState(initialKeyword)
  const [searchId, setSearchId] = useState<string>()
  const [sources, setSources] = useState<Record<string, SourceSearchState>>({})
  const [viewMode, setViewMode] = useState<ResultViewMode>(() => loadViewMode())
  const [histories, setHistories] = useState<string[]>(() => loadHistories())
  const [enabledSourceCount, setEnabledSourceCount] = useState(0)
  const [isSourcesReady, setIsSourcesReady] = useState(false)

  const sourceList = useMemo(() => Object.values(sources), [sources])
  const allItems = useMemo(() => sourceList.flatMap((source) => source.items), [sourceList])
  const groupedResults = useMemo(() => groupSearchResults(allItems), [allItems])
  const stats = useMemo(() => getSourceStats(sourceList, enabledSourceCount), [enabledSourceCount, sourceList])
  const hasAvailableSources = enabledSourceCount > 0

  const updateHistories = useCallback((updater: (current: string[]) => string[]) => {
    setHistories((current) => {
      const nextHistories = updater(current)
      saveHistories(nextHistories)
      return nextHistories
    })
  }, [])

  const refreshEnabledSourceCount = useCallback(async (): Promise<number> => {
    try {
      const sourceConfigs = await listSources()
      const nextCount = sourceConfigs.filter((source) => !source.disabled).length
      setEnabledSourceCount(nextCount)
      setIsSourcesReady(true)
      return nextCount
    } catch {
      setEnabledSourceCount(0)
      setIsSourcesReady(true)
      return 0
    }
  }, [])

  const startSearch = useCallback(
    async (nextKeyword?: string): Promise<void> => {
      const trimmedKeyword = (nextKeyword ?? keyword).trim()
      if (!trimmedKeyword || !isApiAvailable()) return

      const nextCount = await refreshEnabledSourceCount()
      if (nextCount === 0) {
        if (activeSearchIdRef.current) {
          await cancelVodSearch(activeSearchIdRef.current)
          activeSearchIdRef.current = undefined
        }
        setKeyword(trimmedKeyword)
        setSources({})
        setSearchId(undefined)
        return
      }

      // 新请求开始前取消旧搜索，避免旧事件覆盖新关键词的结果。
      if (activeSearchIdRef.current) await cancelVodSearch(activeSearchIdRef.current)
      setKeyword(trimmedKeyword)
      updateHistories((current) => moveToHistoryTop(current, trimmedKeyword))
      setSources({})
      const result = await searchVod(trimmedKeyword)
      if (!result) return
      activeSearchIdRef.current = result.searchId
      setSearchId(result.searchId)
    },
    [keyword, refreshEnabledSourceCount, updateHistories],
  )

  useEffect(() => {
    return onVodSearchEvent((event) => {
      setSources((current) => reduceSearchEvent(current, event, activeSearchIdRef.current))
      if (event.type === 'done' && event.searchId === activeSearchIdRef.current) {
        activeSearchIdRef.current = undefined
        setSearchId(undefined)
      }
    })
  }, [])

  useEffect(() => {
    queueMicrotask(() => void refreshEnabledSourceCount())
    return onAppDataChange((domain) => {
      if (domain === 'vod-sources' || domain === 'app-data') void refreshEnabledSourceCount()
    })
  }, [refreshEnabledSourceCount])

  useEffect(() => {
    const synchronizeHistories = (event: StorageEvent): void => {
      if (event.key === null || event.key === SEARCH_HISTORY_STORAGE_KEY) setHistories(loadHistories())
    }
    window.addEventListener('storage', synchronizeHistories)
    return () => window.removeEventListener('storage', synchronizeHistories)
  }, [])

  useEffect(() => {
    if (!isSourcesReady) return
    if (initialKeyword && lastUrlKeywordRef.current !== initialKeyword) {
      lastUrlKeywordRef.current = initialKeyword
      void startSearch(initialKeyword)
    }
  }, [initialKeyword, isSourcesReady, startSearch])

  const cancelSearch = async (): Promise<void> => {
    if (!activeSearchIdRef.current) return
    await cancelVodSearch(activeSearchIdRef.current)
    activeSearchIdRef.current = undefined
    setSearchId(undefined)
  }

  const changeViewMode = (nextViewMode: ResultViewMode): void => {
    setViewMode(nextViewMode)
    localStorage.setItem(SEARCH_VIEW_MODE_STORAGE_KEY, nextViewMode)
  }

  return {
    allItems,
    groupedResults,
    hasAvailableSources,
    hasSearched: Boolean(searchId) || sourceList.length > 0 || allItems.length > 0,
    histories,
    isSearching: sourceList.some((source) => source.status === 'searching'),
    isSourcesReady,
    keyword,
    searchId,
    sourceList,
    stats,
    viewMode,
    cancelSearch,
    changeViewMode,
    removeHistory: (history) => updateHistories((current) => current.filter((item) => item !== history)),
    clearHistories: () => updateHistories(() => []),
  }
}
