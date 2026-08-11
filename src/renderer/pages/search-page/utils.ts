import { SEARCH_HISTORY_STORAGE_KEY, SEARCH_VIEW_MODE_STORAGE_KEY } from '@shared/constants'
import type { SearchEvent, SearchSourceStatus, VodSearchResult } from '@shared/types'
import { countBy, uniq } from 'es-toolkit/array'
import type { GroupedSearchResult, ResultViewMode, SearchSourceStats, SourceSearchState } from './types'

/** 按规范化标题聚合不同来源的搜索结果 */
export function groupSearchResults(items: VodSearchResult[]): GroupedSearchResult[] {
  const groups = new Map<string, GroupedSearchResult>()
  for (const item of items) {
    const key = normalizeTitle(item.title)
    const current = groups.get(key)
    if (current) {
      current.items.push(item)
      current.sourceNames = uniq([...current.sourceNames, item.sourceName])
      if (!current.poster && item.poster) {
        current.poster = item.poster
        current.posterSourceId = item.sourceId
        current.posterSourceUrl = item.sourceUrl
      }
      current.remarks ||= item.remarks
      continue
    }
    groups.set(key, {
      key,
      title: item.title,
      poster: item.poster,
      posterSourceId: item.poster ? item.sourceId : undefined,
      posterSourceUrl: item.sourceUrl,
      meta: formatMeta(item),
      remarks: item.remarks,
      items: [item],
      sourceNames: [item.sourceName],
    })
  }
  return Array.from(groups.values()).sort(
    (first, second) => second.sourceNames.length - first.sourceNames.length || first.title.localeCompare(second.title),
  )
}

/** 统计搜索中的来源数、完成数、失败数和结果数 */
export function getSourceStats(sources: SourceSearchState[], enabledSourceCount: number): SearchSourceStats {
  const counts = countBy(sources, (source) => source.status)
  const searching = counts.searching ?? 0
  const success = counts.success ?? 0
  const empty = counts.empty ?? 0
  const failed = (counts.error ?? 0) + (counts.timeout ?? 0) + (counts.cancelled ?? 0)
  return {
    searching: Math.max(0, enabledSourceCount - success - empty - failed) || searching,
    success,
    empty,
    failed,
    total: Math.max(enabledSourceCount, sources.length),
  }
}

/** 将搜索结果的年份、地区和分类拼接为元信息 */
export function formatMeta(item: VodSearchResult): string {
  return [item.year, item.area, item.category].filter(Boolean).join(' · ') || '暂无详细信息'
}

/** 返回搜索来源状态对应的徽标色调 */
export function getStatusTone(status: SearchSourceStatus): string {
  if (status === 'success') return 'bg-accent text-primary'
  if (status === 'error' || status === 'timeout' || status === 'cancelled') {
    return 'bg-destructive/10 text-destructive'
  }
  if (status === 'searching') return 'bg-primary/10 text-primary'
  return 'bg-muted text-muted-foreground'
}

/** 将搜索词移动到历史记录顶部 */
export function moveToHistoryTop(histories: string[], keyword: string): string[] {
  return [keyword, ...histories.filter((history) => history !== keyword)]
}

/** 根据搜索事件归并下一份搜索状态 */
export function reduceSearchEvent(
  current: Record<string, SourceSearchState>,
  event: SearchEvent,
  activeSearchId?: string,
): Record<string, SourceSearchState> {
  if (activeSearchId && event.searchId !== activeSearchId) return current
  if (event.type === 'done') return current
  const previous = current[event.sourceId]
  const base = { sourceId: event.sourceId, sourceName: event.sourceName, items: previous?.items ?? [] }
  if (event.type === 'source-start') {
    return { ...current, [event.sourceId]: { ...base, status: 'searching' } }
  }
  if (event.type === 'source-result') {
    return {
      ...current,
      [event.sourceId]: { ...base, status: event.items.length > 0 ? 'success' : 'empty', items: event.items },
    }
  }
  if (event.type === 'source-error' || event.type === 'source-timeout') {
    return {
      ...current,
      [event.sourceId]: {
        ...base,
        status: event.type === 'source-timeout' ? 'timeout' : 'error',
        message: event.message,
      },
    }
  }
  return { ...current, [event.sourceId]: { ...base, status: 'cancelled' } }
}

/** 移除标题空白并转换为小写 */
export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, '').toLocaleLowerCase()
}

/** 从本地存储读取搜索历史记录 */
export function loadHistories(): string[] {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

/** 将搜索历史记录写入本地存储 */
export function saveHistories(histories: string[]): void {
  localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(histories))
}

/** 从本地存储读取搜索结果视图模式 */
export function loadViewMode(): ResultViewMode {
  return localStorage.getItem(SEARCH_VIEW_MODE_STORAGE_KEY) === 'source' ? 'source' : 'grouped'
}
