import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SEARCH_VIEW_MODE_STORAGE_KEY } from '@shared/constants'
import type { VodSearchResult } from '@shared/types'
import { cancelVodSearch, isApiAvailable, listSources, onVodSearchEvent, searchVod } from '@renderer/services/api'
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
  hasSearched: boolean
  histories: string[]
  isSearching: boolean
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

  const sourceList = useMemo(() => Object.values(sources), [sources])
  const allItems = useMemo(() => sourceList.flatMap((source) => source.items), [sourceList])
  const groupedResults = useMemo(() => groupSearchResults(allItems), [allItems])
  const stats = useMemo(() => getSourceStats(sourceList, enabledSourceCount), [enabledSourceCount, sourceList])

  const updateHistories = useCallback((updater: (current: string[]) => string[]) => {
    setHistories((current) => {
      const nextHistories = updater(current)
      saveHistories(nextHistories)
      return nextHistories
    })
  }, [])

  const startSearch = useCallback(
    async (nextKeyword?: string): Promise<void> => {
      const trimmedKeyword = (nextKeyword ?? keyword).trim()
      if (!trimmedKeyword || !isApiAvailable()) return
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
    [keyword, updateHistories],
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
    let active = true
    void listSources()
      .then((sourceConfigs) => {
        if (active) setEnabledSourceCount(sourceConfigs.filter((source) => source.enabled).length)
      })
      .catch(() => {
        if (active) setEnabledSourceCount(0)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (initialKeyword && lastUrlKeywordRef.current !== initialKeyword) {
      lastUrlKeywordRef.current = initialKeyword
      void startSearch(initialKeyword)
    }
  }, [initialKeyword, startSearch])

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
    hasSearched: Boolean(searchId) || sourceList.length > 0 || allItems.length > 0,
    histories,
    isSearching: sourceList.some((source) => source.status === 'searching'),
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
