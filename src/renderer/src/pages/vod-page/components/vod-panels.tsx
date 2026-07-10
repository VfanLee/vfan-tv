import { ArrowUpDown, CheckCircle2, ListVideo, Loader2, Radio, RefreshCw } from 'lucide-react'
import type { PlayLine, VodSearchResult } from '@shared/types'
import { cn } from '@renderer/utils/cn'
import type { EpisodeSelection, SourceProbeState, SourceRefreshState } from '../types'
import { getCandidateKey } from '../utils'

export function NowPlayingTitle({ title }: { title?: string }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-end text-xl leading-6 font-semibold">
      <span className="truncate text-right">正在播放：{title ?? '请选择剧集'}</span>
    </div>
  )
}

export function VodDetailPanel({ items }: { items: Array<{ label: string; value: string }> }): React.JSX.Element {
  return (
    <section className="mt-5 grid grid-cols-1 gap-2">
      {items.map((item) => (
        <div key={item.label} className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-3">
          <span className="text-muted-foreground text-sm font-medium">{item.label}</span>
          <span className="text-foreground min-w-0 truncate text-sm font-semibold" title={item.value}>
            {item.value}
          </span>
        </div>
      ))}
    </section>
  )
}

export function PanelTab({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  icon: typeof ListVideo
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      className={cn(
        'text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2',
        active && 'bg-card text-primary shadow-sm',
      )}
      type="button"
      onClick={onClick}
    >
      <Icon size={17} />
      {label}
    </button>
  )
}

export function EpisodesPanel({
  activeLine,
  activeSelection,
  isDescending,
  lines,
  onSelectEpisode,
  onToggleOrder,
}: {
  activeLine?: PlayLine
  activeSelection: EpisodeSelection
  isDescending: boolean
  lines: PlayLine[]
  onSelectEpisode: (episodeIndex: number) => void
  onToggleOrder: () => void
}): React.JSX.Element {
  const episodeEntries = (activeLine?.episodes ?? []).map((episode, episodeIndex) => ({ episode, episodeIndex }))
  const visibleEpisodes = isDescending ? [...episodeEntries].reverse() : episodeEntries
  if (lines.length === 0) {
    return (
      <div className="border-input text-muted-foreground mt-4 flex h-64 items-center justify-center rounded-xl border border-dashed px-6 text-center text-sm leading-6">
        当前资源没有可用的 m3u8 播放地址，切到换源试试其他来源。
      </div>
    )
  }
  return (
    <section className="flex h-full min-h-0 flex-col pt-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-foreground text-sm font-semibold">共 {activeLine?.episodes.length ?? 0} 集</h2>
        <button
          aria-label={`切换为${isDescending ? '正序' : '倒序'}`}
          className="border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring inline-flex h-8 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-semibold outline-none focus-visible:ring-2"
          type="button"
          onClick={onToggleOrder}
        >
          <ArrowUpDown size={14} />
          {isDescending ? '倒序' : '正序'}
        </button>
      </div>
      <div className="mt-3 grid min-h-0 flex-1 auto-rows-max grid-cols-2 gap-2 overflow-y-auto pr-1 pb-2">
        {visibleEpisodes.map(({ episode, episodeIndex }) => (
          <button
            key={`${episode.name}-${episode.url}`}
            className={cn(
              'focus-visible:ring-ring flex h-12 min-w-0 items-center justify-center rounded-xl border px-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2',
              activeSelection.episodeIndex === episodeIndex
                ? 'border-primary bg-accent text-primary'
                : 'border-border bg-muted text-muted-foreground hover:border-input hover:text-foreground',
            )}
            title={episode.name}
            type="button"
            onClick={() => onSelectEpisode(episodeIndex)}
          >
            <span className="truncate">{episode.name}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

export function SourcesPanel({
  isRefreshing,
  keyword,
  onProbe,
  onRefresh,
  onSelect,
  probeStates,
  refreshState,
  rows,
}: {
  isRefreshing: boolean
  keyword: string
  onProbe: () => void
  onRefresh: () => void
  onSelect: (item: VodSearchResult) => void
  probeStates: Record<string, SourceProbeState>
  refreshState: SourceRefreshState
  rows: Array<{ item: VodSearchResult; count: number; isActive: boolean }>
}): React.JSX.Element {
  const isProbing = Object.values(probeStates).some((state) => state.status === 'loading')
  return (
    <section className="flex h-full min-h-0 flex-col pt-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm font-medium">当前缓存来源 {rows.length} 个</p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            className="border-border bg-card text-primary hover:bg-accent focus-visible:ring-ring inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isRefreshing}
            type="button"
            onClick={onRefresh}
          >
            {isRefreshing ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
            {isRefreshing ? '刷新中...' : '刷新'}
          </button>
          <button
            className="border-border bg-card text-primary hover:bg-accent focus-visible:ring-ring inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isRefreshing || isProbing || rows.length === 0}
            type="button"
            onClick={onProbe}
          >
            {isProbing ? <Loader2 className="animate-spin" size={16} /> : <Radio size={16} />}
            {isProbing ? '测速中...' : '测速'}
          </button>
        </div>
      </div>
      {isRefreshing || refreshState.finished > 0 ? (
        <p className="text-muted-foreground mt-3 text-xs font-medium">
          {isRefreshing ? '正在刷新' : '刷新完成'}，新增匹配 {refreshState.found} 条，失败 {refreshState.failed} 个源
        </p>
      ) : null}
      {rows.length > 0 ? (
        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1 pb-2">
          {rows.map(({ count, isActive, item }) => {
            const probeState = probeStates[getCandidateKey(item)]
            return (
              <button
                key={`${item.sourceId}-${item.vodId}`}
                className={cn(
                  'focus-visible:ring-ring grid h-auto w-full grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-3 rounded-xl border p-3 text-left transition-colors outline-none focus-visible:ring-2',
                  isActive ? 'border-primary bg-accent' : 'border-border bg-muted hover:border-input',
                )}
                type="button"
                onClick={() => onSelect(item)}
              >
                <span
                  className={cn(
                    'mt-0.5 flex size-5 items-center justify-center rounded-full border',
                    isActive ? 'border-primary text-primary' : 'border-input text-transparent',
                  )}
                >
                  <CheckCircle2 size={14} />
                </span>
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="text-foreground truncate text-sm font-semibold">{item.sourceName}</span>
                    <span className="bg-card text-primary shrink-0 rounded-xl px-1.5 py-0.5 text-xs font-semibold">
                      缓存
                    </span>
                  </span>
                  {probeState ? <SourceProbeTags state={probeState} /> : null}
                  <span className="text-muted-foreground mt-1 block truncate text-xs font-medium">
                    {[item.year, item.area, item.remarks || item.category].filter(Boolean).join(' · ') ||
                      keyword ||
                      '同名资源'}
                  </span>
                </span>
                <span className="bg-card text-muted-foreground mt-0.5 shrink-0 rounded-xl px-2 py-1 text-xs font-semibold">
                  {count} 集
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="border-input text-muted-foreground mt-4 flex h-60 items-center justify-center rounded-xl border border-dashed px-6 text-center text-sm leading-6">
          当前没有可切换的缓存来源，可以手动刷新更多来源。
        </div>
      )}
    </section>
  )
}

function SourceProbeTags({ state }: { state: SourceProbeState }): React.JSX.Element {
  const latencyText =
    state.status === 'loading' ? '延迟检测中' : state.latencyMs === null ? '延迟检测失败' : `${state.latencyMs}ms`
  const qualityText = state.status === 'loading' ? '清晰度检测中' : (state.quality ?? '清晰度检测失败')
  const qualityClassName =
    state.status === 'loading'
      ? 'animate-pulse border-sky-500/30 bg-sky-500/15 text-sky-700 dark:text-sky-300'
      : state.quality
        ? 'border-violet-500/30 bg-violet-500/15 text-violet-700 dark:text-violet-300'
        : 'border-red-500/30 bg-red-500/15 text-red-700 dark:text-red-300'
  return (
    <span className="mt-2 flex flex-wrap gap-1.5">
      <span className={cn('rounded-lg border px-1.5 py-0.5 text-[11px] font-semibold', getLatencyTagClassName(state))}>
        {latencyText}
      </span>
      <span className={cn('rounded-lg border px-1.5 py-0.5 text-[11px] font-semibold', qualityClassName)}>
        {qualityText}
      </span>
    </span>
  )
}

function getLatencyTagClassName(state: SourceProbeState): string {
  if (state.status === 'loading') return 'animate-pulse border-sky-500/30 bg-sky-500/15 text-sky-700 dark:text-sky-300'
  if (state.latencyMs === null || state.latencyMs > 1000)
    return 'border-red-500/30 bg-red-500/15 text-red-700 dark:text-red-300'
  if (state.latencyMs > 500) return 'border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300'
  return 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
}
