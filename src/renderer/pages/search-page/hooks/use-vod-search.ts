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

/** 搜索所有已启用点播源，并维护进度、结果、统计和历史记录 */
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

  /** 按源组织的搜索状态列表 */
  const sourceList = useMemo(() => Object.values(sources), [sources])
  /** 所有点播源返回的搜索结果 */
  const allItems = useMemo(() => sourceList.flatMap((source) => source.items), [sourceList])
  /** 按标准化标题聚合后的搜索结果 */
  const groupedResults = useMemo(() => groupSearchResults(allItems), [allItems])
  /** 是否已经启动搜索或收到搜索事件 */
  const hasSearched = Boolean(searchId) || sourceList.length > 0
  /** 当前搜索任务的来源与结果统计 */
  const stats = useMemo(
    () => getSourceStats(sourceList, hasSearched ? enabledSourceCount : 0),
    [enabledSourceCount, hasSearched, sourceList],
  )
  const hasAvailableSources = enabledSourceCount > 0

  /** 更新历史记录 */
  const updateHistories = useCallback((updater: (current: string[]) => string[]) => {
    setHistories((current) => {
      const nextHistories = updater(current)
      saveHistories(nextHistories)
      return nextHistories
    })
  }, [])

  /** 刷新启用的源数量 */
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

  /** 开始搜索 */
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

      // 启动新搜索前取消旧任务，后续只接收新搜索事件。
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

  /** 订阅点播搜索事件并合并搜索结果 */
  useEffect(() => {
    return onVodSearchEvent((event) => {
      setSources((current) => reduceSearchEvent(current, event, activeSearchIdRef.current))
      if (event.type === 'done' && event.searchId === activeSearchIdRef.current) {
        activeSearchIdRef.current = undefined
        setSearchId(undefined)
      }
    })
  }, [])

  /** 加载可用点播源数量并订阅源数据变化 */
  useEffect(() => {
    queueMicrotask(() => void refreshEnabledSourceCount())
    return onAppDataChange((domain) => {
      if (domain === 'vod-sources' || domain === 'app-data') void refreshEnabledSourceCount()
    })
  }, [refreshEnabledSourceCount])

  /** 监听本地存储变化并同步搜索历史 */
  useEffect(() => {
    /** 同步搜索历史到内存状态和本地存储 */
    const synchronizeHistories = (event: StorageEvent): void => {
      if (event.key === null || event.key === SEARCH_HISTORY_STORAGE_KEY) setHistories(loadHistories())
    }
    window.addEventListener('storage', synchronizeHistories)
    return () => window.removeEventListener('storage', synchronizeHistories)
  }, [])

  /** 点播源就绪后执行查询参数中的搜索词 */
  useEffect(() => {
    if (!isSourcesReady) return
    if (initialKeyword && lastUrlKeywordRef.current !== initialKeyword) {
      lastUrlKeywordRef.current = initialKeyword
      void startSearch(initialKeyword)
    }
  }, [initialKeyword, isSourcesReady, startSearch])

  /** 取消搜索 */
  const cancelSearch = async (): Promise<void> => {
    if (!activeSearchIdRef.current) return
    await cancelVodSearch(activeSearchIdRef.current)
    activeSearchIdRef.current = undefined
    setSearchId(undefined)
  }

  /** 切换视图模式 */
  const changeViewMode = (nextViewMode: ResultViewMode): void => {
    setViewMode(nextViewMode)
    localStorage.setItem(SEARCH_VIEW_MODE_STORAGE_KEY, nextViewMode)
  }

  return {
    allItems,
    groupedResults,
    hasAvailableSources,
    hasSearched,
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
