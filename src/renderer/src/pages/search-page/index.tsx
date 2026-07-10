import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { AlertCircle, CheckCircle2, ChevronRight, Clock3, Loader2, MinusCircle, Play, Search, X } from 'lucide-react'
import { SEARCH_HISTORY_STORAGE_KEY, SEARCH_VIEW_MODE_STORAGE_KEY } from '@shared/constants'
import type { SearchEvent, SearchSourceStatus, VodSearchResult } from '@shared/types'
import { MediaPoster } from '@renderer/components'
import { cn } from '@renderer/utils/cn'
import { cancelVodSearch, isApiAvailable, listSources, onVodSearchEvent, searchVod } from '@renderer/services/api'
import { useSearchContextStore } from '@renderer/stores/search-context'

interface SourceSearchState {
  sourceId: string
  sourceName: string
  status: SearchSourceStatus
  items: VodSearchResult[]
  message?: string
}

interface GroupedSearchResult {
  key: string
  title: string
  poster?: string
  posterSourceUrl?: string
  meta: string
  remarks?: string
  items: VodSearchResult[]
  sourceNames: string[]
}

type ResultViewMode = 'grouped' | 'source'

const statusLabel: Record<SearchSourceStatus, string> = {
  pending: '等待中',
  searching: '搜索中',
  success: '已找到',
  empty: '无结果',
  error: '失败',
  timeout: '超时',
  cancelled: '已取消',
}

export function SearchPage(): React.JSX.Element {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const setContext = useSearchContextStore((state) => state.setContext)
  const initialKeyword = searchParams.get('keyword')?.trim() ?? ''
  const lastUrlKeywordRef = useRef('')
  const activeSearchIdRef = useRef<string | undefined>(undefined)
  const [keyword, setKeyword] = useState(initialKeyword)
  const [searchId, setSearchId] = useState<string | undefined>(undefined)
  const [sources, setSources] = useState<Record<string, SourceSearchState>>({})
  const [viewMode, setViewMode] = useState<ResultViewMode>(() => loadViewMode())
  const [histories, setHistories] = useState<string[]>(() => loadHistories())
  const [enabledSourceCount, setEnabledSourceCount] = useState(0)

  const sourceList = useMemo(() => Object.values(sources), [sources])
  const allItems = useMemo(() => sourceList.flatMap((source) => source.items), [sourceList])
  const groupedResults = useMemo(() => groupSearchResults(allItems), [allItems])
  const stats = useMemo(() => getSourceStats(sourceList, enabledSourceCount), [enabledSourceCount, sourceList])
  const hasSearched = Boolean(searchId) || sourceList.length > 0 || allItems.length > 0
  const isSearching = sourceList.some((source) => source.status === 'searching')

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

      if (!trimmedKeyword || !isApiAvailable()) {
        return
      }

      if (activeSearchIdRef.current) {
        await cancelVodSearch(activeSearchIdRef.current)
      }

      setKeyword(trimmedKeyword)
      updateHistories((current) => moveToHistoryTop(current, trimmedKeyword))
      setSources({})

      const result = await searchVod(trimmedKeyword)
      if (!result) {
        return
      }

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
        if (active) {
          setEnabledSourceCount(sourceConfigs.filter((source) => source.enabled).length)
        }
      })
      .catch(() => {
        if (active) {
          setEnabledSourceCount(0)
        }
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
    if (!activeSearchIdRef.current) {
      return
    }

    await cancelVodSearch(activeSearchIdRef.current)
    activeSearchIdRef.current = undefined
    setSearchId(undefined)
  }

  const changeViewMode = (nextViewMode: ResultViewMode): void => {
    setViewMode(nextViewMode)
    localStorage.setItem(SEARCH_VIEW_MODE_STORAGE_KEY, nextViewMode)
  }

  const openGroupedPlayer = (group: GroupedSearchResult): void => {
    const firstItem = group.items[0]
    if (!firstItem) {
      return
    }

    setContext(keyword.trim(), group.items)
    navigate(`/player/${firstItem.sourceId}/${firstItem.vodId}`)
  }

  const openSourcePlayer = (item: VodSearchResult): void => {
    setContext(
      keyword.trim(),
      allItems.filter((candidate) => normalizeTitle(candidate.title) === normalizeTitle(item.title)),
    )
    navigate(`/player/${item.sourceId}/${item.vodId}`)
  }

  return (
    <div className="bg-background text-foreground min-h-full px-10 pb-10">
      <div className="mx-auto max-w-[1280px] pt-8">
        <SearchHistory
          histories={histories}
          onClear={() => updateHistories(() => [])}
          onPick={(history) => navigate(`/search?keyword=${encodeURIComponent(history)}`)}
          onRemove={(history) => updateHistories((current) => current.filter((item) => item !== history))}
        />

        <section className="border-border mt-8 border-t pt-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <h1 className="text-lg font-semibold tracking-tight">搜索结果</h1>
              <SearchStats stats={stats} />
            </div>
            <div className="flex items-center gap-3">
              {isSearching || searchId ? (
                <button
                  className="border-primary bg-card text-primary hover:bg-accent focus-visible:ring-ring h-10 rounded-xl border px-4 text-sm font-semibold outline-none focus-visible:ring-2"
                  type="button"
                  onClick={() => void cancelSearch()}
                >
                  停止搜索
                </button>
              ) : null}
              <ViewModeSwitch value={viewMode} onChange={changeViewMode} />
            </div>
          </div>

          {hasSearched ? (
            viewMode === 'grouped' ? (
              <GroupedResults groups={groupedResults} isSearching={isSearching} onOpen={openGroupedPlayer} />
            ) : (
              <SourceResults sources={sourceList} onOpen={openSourcePlayer} />
            )
          ) : (
            <SearchEmptyState />
          )}
        </section>
      </div>
    </div>
  )
}

function SearchHistory({
  histories,
  onClear,
  onPick,
  onRemove,
}: {
  histories: string[]
  onClear: () => void
  onPick: (history: string) => void
  onRemove: (history: string) => void
}): React.JSX.Element {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-foreground text-base font-semibold">搜索历史</h2>
        <button
          className="text-muted-foreground hover:text-destructive focus-visible:ring-ring text-sm font-medium outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={histories.length === 0}
          type="button"
          onClick={onClear}
        >
          清空
        </button>
      </div>

      {histories.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {histories.map((history) => (
            <span
              key={history}
              className="group border-border bg-card text-muted-foreground inline-flex h-11 max-w-full items-center gap-2 rounded-xl border pr-1.5 pl-4 text-sm font-medium shadow-sm"
            >
              <Clock3 className="text-muted-foreground shrink-0" size={17} />
              <button
                className="hover:text-primary focus-visible:ring-ring max-w-64 truncate outline-none focus-visible:ring-2"
                type="button"
                onClick={() => onPick(history)}
              >
                {history}
              </button>
              <button
                aria-label={`删除 ${history}`}
                className="text-muted-foreground hover:bg-muted hover:text-destructive focus-visible:ring-ring flex size-8 items-center justify-center rounded-xl outline-none focus-visible:ring-2"
                type="button"
                onClick={() => onRemove(history)}
              >
                <X size={15} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="border-input text-muted-foreground rounded-xl border border-dashed px-4 py-6 text-center text-sm">
          搜过的关键词会保存在这里。
        </p>
      )}
    </section>
  )
}

function SearchStats({ stats }: { stats: ReturnType<typeof getSourceStats> }): React.JSX.Element {
  const items = [
    { icon: Loader2, label: '正在搜索', value: stats.searching, tone: 'text-primary', spin: true },
    { icon: CheckCircle2, label: '已找到', value: stats.success, tone: 'text-primary' },
    {
      icon: MinusCircle,
      label: '无结果',
      value: stats.empty,
      tone: 'text-muted-foreground',
    },
    { icon: AlertCircle, label: '搜索失败', value: stats.failed, tone: 'text-destructive' },
  ]

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {items.map((item) => (
        <span key={item.label} className="text-muted-foreground inline-flex items-center gap-2 text-sm font-medium">
          <item.icon className={cn(item.tone, item.spin && stats.searching > 0 && 'animate-spin')} size={17} />
          {item.label}
          <span className="text-foreground">{item.value}</span>
        </span>
      ))}
    </div>
  )
}

function ViewModeSwitch({
  onChange,
  value,
}: {
  onChange: (value: ResultViewMode) => void
  value: ResultViewMode
}): React.JSX.Element {
  return (
    <div className="bg-muted flex rounded-xl p-1">
      {[
        { value: 'grouped' as const, label: '按组展示' },
        { value: 'source' as const, label: '按源展示' },
      ].map((tab) => (
        <button
          key={tab.value}
          className={cn(
            'text-muted-foreground hover:text-foreground focus-visible:ring-ring h-10 rounded-xl px-5 text-sm font-semibold transition-colors outline-none focus-visible:ring-2',
            value === tab.value && 'bg-card text-primary shadow-sm',
          )}
          type="button"
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function GroupedResults({
  groups,
  isSearching,
  onOpen,
}: {
  groups: GroupedSearchResult[]
  isSearching: boolean
  onOpen: (group: GroupedSearchResult) => void
}): React.JSX.Element {
  if (groups.length === 0) {
    return <ResultPlaceholder isSearching={isSearching} />
  }

  return (
    <section className="space-y-3">
      {groups.map((group) => (
        <button
          key={group.key}
          className="border-border bg-card hover:border-input hover:bg-accent/50 focus-visible:ring-ring grid w-full grid-cols-[128px_minmax(0,1fr)_280px_24px] items-center gap-5 rounded-xl border p-3 text-left shadow-sm transition-colors outline-none focus-visible:ring-2"
          type="button"
          onClick={() => onOpen(group)}
        >
          <MediaPoster
            baseUrl={group.posterSourceUrl}
            className="aspect-[2/3] rounded-xl"
            poster={group.poster}
            title={group.title}
          />
          <div className="min-w-0">
            <h2 className="text-foreground truncate text-xl font-semibold tracking-tight">{group.title}</h2>
            <p className="text-muted-foreground mt-3 truncate text-sm font-medium">{group.meta}</p>
            <p className="text-primary mt-5 text-base font-semibold">已找到 {group.sourceNames.length} 个来源</p>
          </div>
          <div className="text-muted-foreground min-w-0 space-y-2 text-sm">
            {group.sourceNames.slice(0, 4).map((sourceName) => (
              <div key={sourceName} className="flex items-center gap-2">
                <CheckCircle2 className="text-primary shrink-0" size={16} />
                <span className="truncate">{sourceName}</span>
              </div>
            ))}
            {group.sourceNames.length > 4 ? (
              <div className="text-muted-foreground text-xs font-medium">
                还有 {group.sourceNames.length - 4} 个来源
              </div>
            ) : null}
          </div>
          <ChevronRight className="text-muted-foreground" size={22} />
        </button>
      ))}
    </section>
  )
}

function SourceResults({
  onOpen,
  sources,
}: {
  onOpen: (item: VodSearchResult) => void
  sources: SourceSearchState[]
}): React.JSX.Element {
  if (sources.length === 0) {
    return <ResultPlaceholder isSearching={false} />
  }

  return (
    <section className="space-y-4">
      {sources.map((source) => (
        <article key={source.sourceId} className="border-border bg-card rounded-xl border p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-foreground truncate text-base font-semibold">{source.sourceName}</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {source.items.length > 0
                  ? `返回 ${source.items.length} 个结果`
                  : source.message || '等待该源返回搜索结果'}
              </p>
            </div>
            <StatusBadge status={source.status} />
          </div>

          {source.items.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {source.items.map((item) => (
                <SourceResultButton key={`${item.sourceId}-${item.vodId}`} item={item} onClick={() => onOpen(item)} />
              ))}
            </div>
          ) : (
            <div className="border-input text-muted-foreground flex h-24 items-center justify-center rounded-xl border border-dashed text-sm">
              暂无结果
            </div>
          )}
        </article>
      ))}
    </section>
  )
}

function SourceResultButton({ item, onClick }: { item: VodSearchResult; onClick: () => void }): React.JSX.Element {
  return (
    <button
      className="border-border bg-muted hover:border-primary focus-visible:ring-ring grid grid-cols-[58px_1fr] gap-3 rounded-xl border p-2 text-left transition-colors outline-none focus-visible:ring-2"
      type="button"
      onClick={onClick}
    >
      <MediaPoster
        baseUrl={item.sourceUrl}
        className="aspect-[2/3] rounded-xl"
        poster={item.poster}
        title={item.title}
      />
      <div className="min-w-0 py-1">
        <div className="text-primary text-xs font-semibold">{item.sourceName}</div>
        <h3 className="text-foreground mt-1 truncate text-sm font-semibold">{item.title}</h3>
        <p className="text-muted-foreground mt-1 truncate text-xs">{formatMeta(item)}</p>
        <div className="bg-card text-primary mt-3 inline-flex items-center gap-1 rounded-xl px-2 py-1 text-xs font-medium">
          <Play fill="currentColor" size={12} />
          {item.remarks || '播放'}
        </div>
      </div>
    </button>
  )
}

function StatusBadge({ status }: { status: SearchSourceStatus }): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex h-8 shrink-0 items-center rounded-xl px-2.5 text-xs font-semibold',
        getStatusTone(status),
      )}
    >
      {statusLabel[status]}
    </span>
  )
}

function SearchEmptyState(): React.JSX.Element {
  return (
    <div className="border-input bg-card flex h-80 items-center justify-center rounded-xl border border-dashed">
      <div className="text-center">
        <Search className="text-muted-foreground mx-auto" size={30} />
        <div className="text-foreground mt-3 text-sm font-semibold">聚合搜索</div>
        <p className="text-muted-foreground mt-1 text-sm">
          搜索后可以按影片分组查看，也可以切到单个数据源确认返回状态。
        </p>
      </div>
    </div>
  )
}

function ResultPlaceholder({ isSearching }: { isSearching: boolean }): React.JSX.Element {
  return (
    <div className="border-input bg-card flex h-72 items-center justify-center rounded-xl">
      <div className="text-center">
        {isSearching ? (
          <Loader2 className="text-primary mx-auto animate-spin" size={30} />
        ) : (
          <AlertCircle className="text-muted-foreground mx-auto" size={30} />
        )}
        <div className="text-muted-foreground mt-3 text-sm font-semibold">
          {isSearching ? '正在等待数据源返回' : '还没有可展示的结果'}
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          {isSearching ? '多个源会增量出现，先搜到的内容会先展示。' : '换个关键词再试一次。'}
        </p>
      </div>
    </div>
  )
}

function groupSearchResults(items: VodSearchResult[]): GroupedSearchResult[] {
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

  return Array.from(groups.values()).sort((first, second) => {
    return second.sourceNames.length - first.sourceNames.length || first.title.localeCompare(second.title)
  })
}

function getSourceStats(
  sources: SourceSearchState[],
  enabledSourceCount: number,
): {
  searching: number
  success: number
  empty: number
  failed: number
  total: number
} {
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

function formatMeta(item: VodSearchResult): string {
  return [item.year, item.area, item.category].filter(Boolean).join(' · ') || '暂无详细信息'
}

function getStatusTone(status: SearchSourceStatus): string {
  if (status === 'success') {
    return 'bg-accent text-primary'
  }

  if (status === 'error' || status === 'timeout' || status === 'cancelled') {
    return 'bg-destructive/10 text-destructive'
  }

  if (status === 'searching') {
    return 'bg-primary/10 text-primary'
  }

  return 'bg-muted text-muted-foreground'
}

function moveToHistoryTop(histories: string[], keyword: string): string[] {
  return [keyword, ...histories.filter((history) => history !== keyword)]
}

function reduceSearchEvent(
  current: Record<string, SourceSearchState>,
  event: SearchEvent,
  activeSearchId?: string,
): Record<string, SourceSearchState> {
  if (activeSearchId && event.searchId !== activeSearchId) {
    return current
  }

  if (event.type === 'done') {
    return current
  }

  const previous = current[event.sourceId]
  const base = {
    sourceId: event.sourceId,
    sourceName: event.sourceName,
    items: previous?.items ?? [],
  }

  if (event.type === 'source-start') {
    return { ...current, [event.sourceId]: { ...base, status: 'searching' } }
  }

  if (event.type === 'source-result') {
    return {
      ...current,
      [event.sourceId]: {
        ...base,
        status: event.items.length > 0 ? 'success' : 'empty',
        items: event.items,
      },
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

function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, '').toLocaleLowerCase()
}

function loadHistories(): string[] {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function saveHistories(histories: string[]): void {
  localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(histories))
}

function loadViewMode(): ResultViewMode {
  const value = localStorage.getItem(SEARCH_VIEW_MODE_STORAGE_KEY)
  return value === 'source' ? 'source' : 'grouped'
}
