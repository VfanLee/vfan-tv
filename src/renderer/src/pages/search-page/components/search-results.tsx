import { AlertCircle, CheckCircle2, ChevronRight, Loader2, MinusCircle, Play, Search } from 'lucide-react'
import type { SearchSourceStatus, VodSearchResult } from '@shared/types'
import { MediaPoster } from '@renderer/components'
import { cn } from '@renderer/utils/cn'
import type { GroupedSearchResult, ResultViewMode, SearchSourceStats, SourceSearchState } from '../types'
import { formatMeta, getStatusTone } from '../utils'

const statusLabel: Record<SearchSourceStatus, string> = {
  pending: '等待中',
  searching: '搜索中',
  success: '已找到',
  empty: '无结果',
  error: '失败',
  timeout: '超时',
  cancelled: '已取消',
}

export function SearchStats({ stats }: { stats: SearchSourceStats }): React.JSX.Element {
  const items = [
    { icon: Loader2, label: '正在搜索', value: stats.searching, tone: 'text-primary', spin: true },
    { icon: CheckCircle2, label: '已找到', value: stats.success, tone: 'text-primary' },
    { icon: MinusCircle, label: '无结果', value: stats.empty, tone: 'text-muted-foreground' },
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

export function ViewModeSwitch({
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

export function GroupedResults({
  groups,
  isSearching,
  onOpen,
}: {
  groups: GroupedSearchResult[]
  isSearching: boolean
  onOpen: (group: GroupedSearchResult) => void
}): React.JSX.Element {
  if (groups.length === 0) return <ResultPlaceholder isSearching={isSearching} />
  return (
    <section className="flex flex-col gap-3">
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
          <div className="text-muted-foreground flex min-w-0 flex-col gap-2 text-sm">
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

export function SourceResults({
  onOpen,
  sources,
}: {
  onOpen: (item: VodSearchResult) => void
  sources: SourceSearchState[]
}): React.JSX.Element {
  if (sources.length === 0) return <ResultPlaceholder isSearching={false} />
  return (
    <section className="flex flex-col gap-4">
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

export function SearchEmptyState(): React.JSX.Element {
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
