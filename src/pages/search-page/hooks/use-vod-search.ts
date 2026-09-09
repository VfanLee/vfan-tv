import { toast } from 'sonner'
import { useSearchHistoryStore, useUiPreferencesStore } from '@/stores'
import { isDesktopRuntime, subscribeDesktopEvent } from '@/platform/tauri'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { VodSearchResult } from '@/types'
import {
  cancelVodSearch,
  isApiAvailable,
  listSources,
  onAppDataChange,
  onVodSearchEvent,
  searchVod,
} from '@/platform/api'
import type { GroupedSearchResult, ResultViewMode, SearchSourceStats, SourceSearchState } from '../types'
import { getSourceStats, groupSearchResults, reduceSearchEvent } from '../utils'

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
  const searchGenerationRef = useRef(0)
  const activeSearchIdRef = useRef<string | undefined>(undefined)
  const [keyword, setKeyword] = useState(initialKeyword)
  const [searchId, setSearchId] = useState<string>()
  const [sources, setSources] = useState<Record<string, SourceSearchState>>({})
  const viewMode = useUiPreferencesStore((state) => state.searchViewMode)
  const setViewMode = useUiPreferencesStore((state) => state.setSearchViewMode)
  const histories = useSearchHistoryStore((state) => state.histories)
  const changeHistory = useSearchHistoryStore((state) => state.change)
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
      if (!trimmedKeyword || (!isDesktopRuntime() && !isApiAvailable())) return

      const generation = ++searchGenerationRef.current
      const nextCount = await refreshEnabledSourceCount()
      if (generation !== searchGenerationRef.current) return
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
      changeHistory('add', trimmedKeyword)
      setSources({})
      try {
        await searchVod(trimmedKeyword, (id) => {
          if (generation !== searchGenerationRef.current) throw new Error('搜索已被替换')
          activeSearchIdRef.current = id
          setSearchId(id)
        })
      } catch (error) {
        if (generation !== searchGenerationRef.current) return
        activeSearchIdRef.current = undefined
        setSearchId(undefined)
        toast.error('启动搜索失败', { description: String(error) })
      }
    },
    [keyword, refreshEnabledSourceCount, changeHistory],
  )

  /** 订阅点播搜索事件并合并搜索结果 */
  useEffect(() => {
    const unsubscribe = onVodSearchEvent((event) => {
      const activeId = activeSearchIdRef.current
      if (!activeId || event.searchId !== activeId) return
      setSources((current) => reduceSearchEvent(current, event, activeId))
      if (event.type === 'done' && event.searchId === activeSearchIdRef.current) {
        activeSearchIdRef.current = undefined
        setSearchId(undefined)
      }
    })
    return () => {
      unsubscribe()
      searchGenerationRef.current += 1
      if (activeSearchIdRef.current) void cancelVodSearch(activeSearchIdRef.current).catch(console.error)
      activeSearchIdRef.current = undefined
    }
  }, [])

  /** 加载可用点播源数量并订阅源数据变化 */
  useEffect(() => {
    queueMicrotask(() => void refreshEnabledSourceCount())
    return onAppDataChange((domain) => {
      if (domain === 'vod-sources' || domain === 'app-data') void refreshEnabledSourceCount()
    })
  }, [refreshEnabledSourceCount])

  /** 加载数据库历史并订阅跨窗口变更 */
  useEffect(() => {
    void useSearchHistoryStore.getState().refresh()
    if (isDesktopRuntime())
      return subscribeDesktopEvent('search-history-changed', () => {
        void useSearchHistoryStore.getState().refresh()
      })
    return undefined
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
    removeHistory: (history) => changeHistory('remove', history),
    clearHistories: () => changeHistory('clear'),
  }
}
