import { SEARCH_HISTORY_STORAGE_KEY, SEARCH_VIEW_MODE_STORAGE_KEY } from '@shared/constants'
import type { SearchEvent, SearchSourceStatus, VodSearchResult } from '@shared/types'
import type { GroupedSearchResult, ResultViewMode, SearchSourceStats, SourceSearchState } from './types'

export function groupSearchResults(items: VodSearchResult[]): GroupedSearchResult[] {
  const groups = new Map<string, GroupedSearchResult>()
  for (const item of items) {
    const key = normalizeTitle(item.title)
    const current = groups.get(key)
    if (current) {
      current.items.push(item)
      current.sourceNames = Array.from(new Set([...current.sourceNames, item.sourceName]))
      if (!current.poster && item.poster) {
        current.poster = item.poster
        current.posterSourceUrl = item.sourceUrl
      }
      current.remarks ||= item.remarks
      continue
    }
    groups.set(key, {
      key,
      title: item.title,
      poster: item.poster,
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

export function getSourceStats(sources: SourceSearchState[], enabledSourceCount: number): SearchSourceStats {
  const searching = sources.filter((source) => source.status === 'searching').length
  const success = sources.filter((source) => source.status === 'success').length
  const empty = sources.filter((source) => source.status === 'empty').length
  const failed = sources.filter((source) => ['error', 'timeout', 'cancelled'].includes(source.status)).length
  return {
    searching: Math.max(0, enabledSourceCount - success - empty - failed) || searching,
    success,
    empty,
    failed,
    total: Math.max(enabledSourceCount, sources.length),
  }
}

export function formatMeta(item: VodSearchResult): string {
  return [item.year, item.area, item.category].filter(Boolean).join(' · ') || '暂无详细信息'
}

export function getStatusTone(status: SearchSourceStatus): string {
  if (status === 'success') return 'bg-accent text-primary'
  if (status === 'error' || status === 'timeout' || status === 'cancelled') {
    return 'bg-destructive/10 text-destructive'
  }
  if (status === 'searching') return 'bg-primary/10 text-primary'
  return 'bg-muted text-muted-foreground'
}

export function moveToHistoryTop(histories: string[], keyword: string): string[] {
  return [keyword, ...histories.filter((history) => history !== keyword)]
}

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

export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, '').toLocaleLowerCase()
}

export function loadHistories(): string[] {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function saveHistories(histories: string[]): void {
  localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(histories))
}

export function loadViewMode(): ResultViewMode {
  return localStorage.getItem(SEARCH_VIEW_MODE_STORAGE_KEY) === 'source' ? 'source' : 'grouped'
}
