import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { ArrowLeft, ArrowUpDown, CheckCircle2, Heart, ListVideo, Loader2, Radio, RefreshCw } from 'lucide-react'
import type { FavoriteInput, PlayLine, RecentPlayInput, VodSearchResult } from '@shared/types'
import { parseVodPlayUrl } from '@shared/utils/vod-play-url'
import { BasicPlayer, MediaPoster } from '@renderer/components'
import { cn } from '@renderer/utils/cn'
import {
  addFavorite,
  cancelVodSearch,
  isApiAvailable,
  isFavorite as checkIsFavorite,
  onVodSearchEvent,
  probeMediaSource,
  removeFavorite,
  searchVod,
  upsertRecentPlay,
} from '@renderer/services/api'
import { useSearchContextStore } from '@renderer/stores/search-context'

interface EpisodeSelection {
  resourceKey: string
  lineIndex: number
  episodeIndex: number
}

type PlayerTab = 'episodes' | 'sources'

interface SourceRefreshState {
  found: number
  failed: number
  finished: number
}

type SourceProbeState = { status: 'loading' } | { status: 'complete'; latencyMs: number | null; quality: string | null }

interface SourceProbeRequest {
  items: VodSearchResult[]
  lineIndex: number
  episodeIndex: number
}

interface PlayerLocationState {
  initialTime?: number
  episodeUrl?: string
  preferredEpisodeIndex?: number
  preferredLineIndex?: number
}

export function PlayerPage(): React.JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const { sourceId, vodId } = useParams()
  const candidates = useSearchContextStore((state) => state.candidates)
  const keyword = useSearchContextStore((state) => state.keyword)
  const mergeCandidates = useSearchContextStore((state) => state.mergeCandidates)
  const [activeTab, setActiveTab] = useState<PlayerTab>('episodes')
  const [isEpisodeDescending, setIsEpisodeDescending] = useState(false)
  const [selection, setSelection] = useState<EpisodeSelection>()
  const [isRefreshingSources, setIsRefreshingSources] = useState(false)
  const [isFavorite, setIsFavorite] = useState(false)
  const [favoriteResourceKey, setFavoriteResourceKey] = useState('')
  const [isFavoriteLoading, setIsFavoriteLoading] = useState(false)
  const [isTheaterMode, setIsTheaterMode] = useState(false)
  const [sourceProbeStates, setSourceProbeStates] = useState<Record<string, SourceProbeState>>({})
  const [sourceProbeRequest, setSourceProbeRequest] = useState<SourceProbeRequest>()
  const [refreshState, setRefreshState] = useState<SourceRefreshState>({
    found: 0,
    failed: 0,
    finished: 0,
  })
  const refreshSearchIdRef = useRef<string | undefined>(undefined)
  const probeAfterRefreshRef = useRef(false)
  const autoRefreshedSourcesRef = useRef<Set<string>>(new Set())
  const autoHydratedTitleRef = useRef<Set<string>>(new Set())
  const lastProgressSaveRef = useRef(0)
  const playbackProgressRef = useRef({ currentTime: 0, duration: 0 })
  const locationState = location.state as PlayerLocationState | null

  const current = useMemo(
    () => candidates.find((item) => item.sourceId === sourceId && item.vodId === vodId),
    [candidates, sourceId, vodId],
  )
  const resourceKey = `${sourceId ?? ''}:${vodId ?? ''}`
  const currentTitleKey = normalizeTitle(current?.title ?? '')
  const lines = useMemo(() => getPlayLines(current), [current])
  const defaultSelection = useMemo(() => getDefaultSelection(lines), [lines])
  const locationEpisodeSelection = useMemo(
    () => getSelectionByEpisodeUrl(lines, resourceKey, locationState?.episodeUrl),
    [lines, locationState?.episodeUrl, resourceKey],
  )
  const locationIndexedSelection = useMemo(
    () =>
      getSelectionByIndexes(
        lines,
        resourceKey,
        locationState?.preferredLineIndex,
        locationState?.preferredEpisodeIndex,
      ),
    [lines, locationState?.preferredEpisodeIndex, locationState?.preferredLineIndex, resourceKey],
  )
  const activeSelection =
    selection?.resourceKey === resourceKey
      ? selection
      : (locationEpisodeSelection ??
        locationIndexedSelection ?? {
          resourceKey,
          lineIndex: defaultSelection.lineIndex,
          episodeIndex: defaultSelection.episodeIndex,
        })
  const activeLine = lines[activeSelection.lineIndex]
  const activeEpisode = activeLine?.episodes[activeSelection.episodeIndex]
  const playerSrc = activeEpisode?.url
  const previousEpisodeIndex = activeSelection.episodeIndex + (isEpisodeDescending ? 1 : -1)
  const nextEpisodeIndex = activeSelection.episodeIndex + (isEpisodeDescending ? -1 : 1)
  const hasPreviousEpisode = Boolean(
    activeLine && previousEpisodeIndex >= 0 && previousEpisodeIndex < activeLine.episodes.length,
  )
  const hasNextEpisode = Boolean(activeLine && nextEpisodeIndex >= 0 && nextEpisodeIndex < activeLine.episodes.length)
  const initialTime =
    shouldApplyLocationInitialTime(locationState, activeSelection, playerSrc) && locationState?.initialTime
      ? Math.max(0, Math.floor(locationState.initialTime))
      : 0
  const playerTitle = activeEpisode ? `${current?.title ?? '未知资源'} - ${activeEpisode.name}` : undefined
  const sameTitleCandidates = useMemo(
    () =>
      dedupeCandidates(
        currentTitleKey
          ? candidates.filter((item) => normalizeTitle(item.title) === currentTitleKey)
          : current
            ? [current]
            : [],
      ),
    [candidates, current, currentTitleKey],
  )
  const sourceRows = useMemo(
    () =>
      sameTitleCandidates.map((item) => ({
        item,
        count: getEpisodeCount(item),
        isActive: item.sourceId === sourceId && item.vodId === vodId,
      })),
    [sameTitleCandidates, sourceId, vodId],
  )
  const detailItems = useMemo(() => getVodDetailItems(current), [current])
  const doubanScore = getDoubanScore(current)
  const remarks = getVodField(current, 'vod_remarks') ?? current?.remarks
  const vodStatus = getVodField(current, 'vod_state')
  const subtitle = getVodField(current, 'vod_sub')
  const isCurrentFavorite = Boolean(current) && favoriteResourceKey === resourceKey && isFavorite
  const metaText = current
    ? [current.year, current.area, current.category].filter(Boolean).join(' · ')
    : '刷新或直接进入播放页时，后续会通过 sourceId + vodId 恢复详情。'

  const refreshSources = useCallback(
    async (shouldProbe = false): Promise<void> => {
      if (!isApiAvailable() || !current?.title || isRefreshingSources) {
        return
      }

      if (refreshSearchIdRef.current) {
        await cancelVodSearch(refreshSearchIdRef.current)
      }

      setRefreshState({ found: 0, failed: 0, finished: 0 })
      setSourceProbeRequest(undefined)
      setSourceProbeStates({})
      probeAfterRefreshRef.current = shouldProbe
      if (shouldProbe) {
        setSourceProbeStates(
          Object.fromEntries(sourceRows.map(({ item }) => [getCandidateKey(item), { status: 'loading' as const }])),
        )
      }

      setIsRefreshingSources(true)
      const result = await searchVod(current.title)
      if (!result) {
        probeAfterRefreshRef.current = false
        setIsRefreshingSources(false)
        if (shouldProbe) {
          setSourceProbeStates({})
        }
        return
      }

      refreshSearchIdRef.current = result.searchId
    },
    [current, isRefreshingSources, sourceRows],
  )

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

  const openSourcesTab = (): void => {
    setActiveTab('sources')

    const refreshKey = `${resourceKey}:${currentTitleKey}`
    if (!currentTitleKey || autoRefreshedSourcesRef.current.has(refreshKey)) {
      return
    }

    autoRefreshedSourcesRef.current.add(refreshKey)
    if (isRefreshingSources) {
      probeAfterRefreshRef.current = true
      setSourceProbeStates(
        Object.fromEntries(sourceRows.map(({ item }) => [getCandidateKey(item), { status: 'loading' as const }])),
      )
      return
    }

    void refreshSources(true)
  }

  useEffect(() => {
    if (!current || !isApiAvailable() || isRefreshingSources) {
      return
    }

    if (locationState?.episodeUrl != null || (locationState?.initialTime ?? 0) > 0) {
      return
    }

    const episodeCount = getEpisodeCount(current)
    const hydrateKey = `${current.sourceId}:${current.vodId}:${currentTitleKey}`

    if (episodeCount !== 1 || !currentTitleKey || autoHydratedTitleRef.current.has(hydrateKey)) {
      return
    }

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

  const saveRecentProgress = async ({
    currentTime,
    duration,
  }: {
    currentTime: number
    duration: number
  }): Promise<void> => {
    playbackProgressRef.current = { currentTime, duration }

    if (!current || !activeLine || !activeEpisode || !isApiAvailable()) {
      return
    }

    const now = Date.now()
    if (now - lastProgressSaveRef.current < 5000 && currentTime > 0 && currentTime < duration) {
      return
    }
    lastProgressSaveRef.current = now

    await upsertRecentPlay(
      createRecentPlayInput(current, activeLine.name, activeEpisode.name, activeEpisode.url, {
        currentTime,
        duration,
      }),
    )
  }

  const selectSource = (item: VodSearchResult): void => {
    const targetLines = getPlayLines(item)
    const preferredLineIndex = Math.min(activeSelection.lineIndex, Math.max(0, targetLines.length - 1))
    const targetLine = targetLines[preferredLineIndex]
    const preferredEpisodeIndex = Math.min(
      activeSelection.episodeIndex,
      Math.max(0, (targetLine?.episodes.length ?? 1) - 1),
    )

    navigate(`/player/${item.sourceId}/${item.vodId}`, {
      replace: true,
      state: {
        initialTime: playbackProgressRef.current.currentTime,
        preferredEpisodeIndex,
        preferredLineIndex,
      } satisfies PlayerLocationState,
    })
  }

  const selectEpisode = (episodeIndex: number): void => {
    if (!sourceId || !vodId) {
      return
    }

    const nextSelection = {
      resourceKey,
      lineIndex: activeSelection.lineIndex,
      episodeIndex,
    }

    setSelection(nextSelection)
    navigate(`/player/${sourceId}/${vodId}`, {
      replace: true,
      state: {
        preferredEpisodeIndex: episodeIndex,
        preferredLineIndex: activeSelection.lineIndex,
      } satisfies PlayerLocationState,
    })
  }

  const toggleFavorite = async (): Promise<void> => {
    if (!current || !isApiAvailable() || isFavoriteLoading) {
      return
    }

    setIsFavoriteLoading(true)
    try {
      if (isCurrentFavorite) {
        await removeFavorite(current.sourceId, current.vodId)
        setIsFavorite(false)
        setFavoriteResourceKey(resourceKey)
        return
      }

      await addFavorite(createFavoriteInput(current))
      setIsFavorite(true)
      setFavoriteResourceKey(resourceKey)
    } finally {
      setIsFavoriteLoading(false)
    }
  }

  useEffect(() => {
    return onVodSearchEvent((event) => {
      if (event.searchId !== refreshSearchIdRef.current) {
        return
      }

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
        setRefreshState((state) => ({
          ...state,
          failed: state.failed + 1,
          finished: state.finished + 1,
        }))
        return
      }

      if (event.type === 'done') {
        refreshSearchIdRef.current = undefined
        setIsRefreshingSources(false)

        if (probeAfterRefreshRef.current) {
          probeAfterRefreshRef.current = false
          const latestItems = dedupeCandidates(
            useSearchContextStore
              .getState()
              .candidates.filter((item) => normalizeTitle(item.title) === currentTitleKey),
          )
          setSourceProbeStates(
            Object.fromEntries(latestItems.map((item) => [getCandidateKey(item), { status: 'loading' as const }])),
          )
          setSourceProbeRequest({
            items: latestItems,
            lineIndex: activeSelection.lineIndex,
            episodeIndex: activeSelection.episodeIndex,
          })
        }
      }
    })
  }, [activeSelection.episodeIndex, activeSelection.lineIndex, currentTitleKey, mergeCandidates])

  useEffect(() => {
    if (!sourceProbeRequest) {
      return
    }

    let active = true
    const targets = sourceProbeRequest.items.map((item) => ({
      item,
      url: getCorrespondingEpisodeUrl(item, sourceProbeRequest.lineIndex, sourceProbeRequest.episodeIndex),
    }))

    void runWithConcurrency(targets, 4, async ({ item, url }) => {
      const result = url
        ? await probeMediaSource({
            url,
            referer: item.sourceUrl,
          })
        : undefined

      if (!active) {
        return
      }

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

  useEffect(() => {
    if (!current || !isApiAvailable()) {
      return
    }

    let active = true

    void checkIsFavorite(current.sourceId, current.vodId).then((nextValue) => {
      if (active) {
        setIsFavorite(nextValue)
        setFavoriteResourceKey(`${current.sourceId}:${current.vodId}`)
      }
    })

    return () => {
      active = false
    }
  }, [current])

  useEffect(() => {
    return () => {
      if (refreshSearchIdRef.current) {
        void cancelVodSearch(refreshSearchIdRef.current)
      }
    }
  }, [currentTitleKey])

  useEffect(() => {
    if (!isTheaterMode) {
      return
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsTheaterMode(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isTheaterMode])

  return (
    <div
      className={cn(
        isTheaterMode
          ? 'fixed inset-0 z-50 flex flex-col bg-black'
          : 'bg-background text-foreground h-screen overflow-y-auto px-8 pb-6',
      )}
    >
      <div
        className={cn(isTheaterMode ? 'min-h-0 flex-1' : 'grid h-screen gap-6 py-5 xl:grid-cols-[minmax(0,1fr)_380px]')}
      >
        <main
          className={cn(
            'min-h-0 min-w-0',
            isTheaterMode ? 'flex h-full items-center justify-center' : 'flex flex-col gap-5',
          )}
        >
          {!isTheaterMode ? (
            <header className="flex h-10 shrink-0 items-center justify-between gap-6">
              <button
                className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors outline-none focus-visible:ring-2"
                type="button"
                onClick={() => navigate(-1)}
              >
                <ArrowLeft size={17} />
                返回
              </button>
              <NowPlayingTitle title={playerTitle} />
            </header>
          ) : null}

          <section
            className={cn(
              'overflow-hidden bg-black',
              isTheaterMode ? 'aspect-video w-full max-w-[calc(100vh*16/9)]' : 'min-h-0 flex-1 rounded-xl',
            )}
          >
            <BasicPlayer
              autoPlay
              className={!isTheaterMode ? 'h-full' : undefined}
              hasNextEpisode={hasNextEpisode}
              hasPreviousEpisode={hasPreviousEpisode}
              initialTime={initialTime}
              isTheaterMode={isTheaterMode}
              src={playerSrc}
              title={playerTitle}
              onEnded={hasNextEpisode ? () => selectEpisode(nextEpisodeIndex) : undefined}
              onNextEpisode={() => selectEpisode(nextEpisodeIndex)}
              onPreviousEpisode={() => selectEpisode(previousEpisodeIndex)}
              onProgress={(progress) => void saveRecentProgress(progress)}
              onToggleTheaterMode={() => setIsTheaterMode((current) => !current)}
            />
          </section>
        </main>

        {!isTheaterMode ? (
          <div className="relative min-h-0">
            <aside className="border-border bg-card absolute inset-0 flex min-h-0 flex-col rounded-xl border p-4 shadow-sm">
              <div className="bg-muted grid grid-cols-2 rounded-xl p-1">
                <PanelTab
                  active={activeTab === 'episodes'}
                  icon={ListVideo}
                  label="选集"
                  onClick={() => setActiveTab('episodes')}
                />
                <PanelTab active={activeTab === 'sources'} icon={Radio} label="换源" onClick={openSourcesTab} />
              </div>

              <div className="min-h-0 flex-1 overflow-hidden">
                {activeTab === 'episodes' ? (
                  <EpisodesPanel
                    activeLine={activeLine}
                    activeSelection={activeSelection}
                    isDescending={isEpisodeDescending}
                    lines={lines}
                    onSelectEpisode={selectEpisode}
                    onToggleOrder={() => setIsEpisodeDescending((current) => !current)}
                  />
                ) : (
                  <SourcesPanel
                    isRefreshing={isRefreshingSources}
                    keyword={keyword}
                    probeStates={sourceProbeStates}
                    refreshState={refreshState}
                    rows={sourceRows}
                    onProbe={() => probeSources()}
                    onRefresh={() => void refreshSources()}
                    onSelect={selectSource}
                  />
                )}
              </div>
            </aside>
          </div>
        ) : null}
      </div>

      {!isTheaterMode ? (
        <section className="border-border bg-card mt-5 flow-root rounded-xl border p-5 shadow-sm">
          <MediaPoster
            baseUrl={current?.sourceUrl}
            className="float-left mr-6 mb-4 aspect-[2/3] w-[clamp(11rem,18vw,14rem)]"
            overlay={
              doubanScore ? (
                <span className="absolute top-2 right-2 rounded-lg bg-black/75 px-2 py-1 text-xs font-semibold text-amber-300 shadow-sm backdrop-blur">
                  豆瓣 {doubanScore}
                </span>
              ) : undefined
            }
            poster={current?.poster}
            title={current?.title ?? '影片海报'}
          />

          <div className="border-border flex min-w-0 flex-wrap items-start justify-between gap-4 border-b pb-5">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1 className="max-w-full truncate text-3xl font-semibold tracking-tight">
                  {current?.title ?? '资源上下文待恢复'}
                </h1>
                {vodStatus ? (
                  <span className="shrink-0 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    {vodStatus}
                  </span>
                ) : null}
                {remarks ? (
                  <span className="border-primary/25 bg-primary/10 text-primary shrink-0 rounded-lg border px-2 py-1 text-xs font-semibold">
                    {remarks}
                  </span>
                ) : null}
              </div>
              {subtitle ? <p className="text-muted-foreground mt-2 text-sm font-medium">{subtitle}</p> : null}
              <p className="text-muted-foreground mt-2 text-sm font-medium">{metaText}</p>
            </div>
            <button
              className={cn(
                'focus-visible:ring-ring inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60',
                isCurrentFavorite
                  ? 'border-primary bg-accent text-primary'
                  : 'border-border bg-card text-muted-foreground hover:border-input hover:text-foreground',
              )}
              disabled={!current || isFavoriteLoading}
              type="button"
              onClick={() => void toggleFavorite()}
            >
              <Heart fill={isCurrentFavorite ? 'currentColor' : 'none'} size={17} />
              {isCurrentFavorite ? '已收藏' : '收藏'}
            </button>
          </div>

          {detailItems.length > 0 ? <VodDetailPanel items={detailItems} /> : null}

          {current?.description ? (
            <p className="text-muted-foreground mt-5 line-clamp-3 text-sm leading-7">{current.description}</p>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

function NowPlayingTitle({ title }: { title?: string }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-end text-xl leading-6 font-semibold">
      <span className="truncate text-right">正在播放：{title ?? '请选择剧集'}</span>
    </div>
  )
}

function VodDetailPanel({ items }: { items: Array<{ label: string; value: string }> }): React.JSX.Element {
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

function PanelTab({
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

function EpisodesPanel({
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

function SourcesPanel({
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
        <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 pb-2">
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
  const latencyClassName = getLatencyTagClassName(state)
  const qualityClassName =
    state.status === 'loading'
      ? 'animate-pulse border-sky-500/30 bg-sky-500/15 text-sky-700 dark:text-sky-300'
      : state.quality
        ? 'border-violet-500/30 bg-violet-500/15 text-violet-700 dark:text-violet-300'
        : 'border-red-500/30 bg-red-500/15 text-red-700 dark:text-red-300'

  return (
    <span className="mt-2 flex flex-wrap gap-1.5">
      <span className={cn('rounded-lg border px-1.5 py-0.5 text-[11px] font-semibold', latencyClassName)}>
        {latencyText}
      </span>
      <span className={cn('rounded-lg border px-1.5 py-0.5 text-[11px] font-semibold', qualityClassName)}>
        {qualityText}
      </span>
    </span>
  )
}

function getLatencyTagClassName(state: SourceProbeState): string {
  if (state.status === 'loading') {
    return 'animate-pulse border-sky-500/30 bg-sky-500/15 text-sky-700 dark:text-sky-300'
  }

  if (state.latencyMs === null || state.latencyMs > 1000) {
    return 'border-red-500/30 bg-red-500/15 text-red-700 dark:text-red-300'
  }

  if (state.latencyMs > 500) {
    return 'border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300'
  }

  return 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
}

function getPlayLines(item: VodSearchResult | undefined): PlayLine[] {
  if (!item || !isRecord(item.raw)) {
    return []
  }

  return parseVodPlayUrl(getString(item.raw.vod_play_url), getString(item.raw.vod_play_from))
    .map((line) => ({
      ...line,
      episodes: line.episodes.filter((episode) => isPlayableUrl(episode.url)),
    }))
    .filter((line) => line.episodes.length > 0)
}

function getDefaultSelection(lines: PlayLine[]): Pick<EpisodeSelection, 'lineIndex' | 'episodeIndex'> {
  const lineIndex = lines.length > 0 ? 0 : 0
  const episodeIndex = lines[lineIndex] ? getPreferredEpisodeIndex(lines[lineIndex]) : 0

  return { lineIndex, episodeIndex }
}

function getSelectionByEpisodeUrl(
  lines: PlayLine[],
  resourceKey: string,
  episodeUrl: string | undefined,
): EpisodeSelection | undefined {
  if (!episodeUrl) {
    return undefined
  }

  for (const [lineIndex, line] of lines.entries()) {
    const episodeIndex = line.episodes.findIndex((episode) => episode.url === episodeUrl)

    if (episodeIndex > -1) {
      return { resourceKey, lineIndex, episodeIndex }
    }
  }

  return undefined
}

function getSelectionByIndexes(
  lines: PlayLine[],
  resourceKey: string,
  lineIndex: number | undefined,
  episodeIndex: number | undefined,
): EpisodeSelection | undefined {
  if (lineIndex === undefined || episodeIndex === undefined || lines.length === 0) {
    return undefined
  }

  const nextLineIndex = Math.min(Math.max(0, lineIndex), lines.length - 1)
  const line = lines[nextLineIndex]

  if (!line || line.episodes.length === 0) {
    return undefined
  }

  return {
    resourceKey,
    lineIndex: nextLineIndex,
    episodeIndex: Math.min(Math.max(0, episodeIndex), line.episodes.length - 1),
  }
}

function shouldApplyLocationInitialTime(
  locationState: PlayerLocationState | null,
  activeSelection: EpisodeSelection,
  playerSrc: string | undefined,
): boolean {
  if (!locationState || !playerSrc) {
    return false
  }

  if (locationState.episodeUrl) {
    return locationState.episodeUrl === playerSrc
  }

  return (
    locationState.preferredLineIndex === activeSelection.lineIndex &&
    locationState.preferredEpisodeIndex === activeSelection.episodeIndex
  )
}

function getPreferredEpisodeIndex(line: PlayLine): number {
  const index = line.episodes.findIndex((episode) => isPlayableUrl(episode.url))
  return index > -1 ? index : 0
}

function getEpisodeCount(item: VodSearchResult): number {
  return getPlayLines(item).reduce((total, line) => total + line.episodes.length, 0)
}

function getCorrespondingEpisodeUrl(
  item: VodSearchResult,
  lineIndex: number,
  episodeIndex: number,
): string | undefined {
  const lines = getPlayLines(item)
  const targetLine = lines[Math.min(Math.max(0, lineIndex), Math.max(0, lines.length - 1))]
  if (!targetLine) {
    return undefined
  }

  return targetLine.episodes[Math.min(Math.max(0, episodeIndex), targetLine.episodes.length - 1)]?.url
}

function isPlayableUrl(url: string): boolean {
  return /^https?:\/\//.test(url) && /\.m3u8(?:[?#]|$)/i.test(url)
}

function dedupeCandidates(items: VodSearchResult[]): VodSearchResult[] {
  const map = new Map<string, VodSearchResult>()

  for (const item of items) {
    map.set(getCandidateKey(item), item)
  }

  return Array.from(map.values())
}

function getCandidateKey(item: VodSearchResult): string {
  return `${item.sourceId}:${item.vodId}`
}

async function runWithConcurrency<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex]
      nextIndex += 1
      if (item) {
        await task(item)
      }
    }
  })

  await Promise.all(workers)
}

function getVodDetailItems(item: VodSearchResult | undefined): Array<{ label: string; value: string }> {
  const details: Array<{ label: string; value: string }> = []

  const fields: Array<[string, string[]]> = [
    ['类型', ['vod_class']],
    ['演员', ['vod_actor']],
    ['导演', ['vod_director']],
    ['编剧', ['vod_writer']],
    ['上映日期', ['vod_pubdate']],
    ['地区', ['vod_area']],
    ['语言', ['vod_lang']],
    ['年份', ['vod_year', 'vod_yea']],
  ]

  fields.forEach(([label, keys]) => {
    const value = keys.map((key) => getVodField(item, key)).find(Boolean)

    if (value) {
      details.push({ label, value })
    }
  })

  return details
}

function getDoubanScore(item: VodSearchResult | undefined): string | undefined {
  if (!item || !isRecord(item.raw)) {
    return undefined
  }

  const value = getNumber(item.raw.vod_douban_score)
  return value > 0 ? value.toFixed(1) : undefined
}

function getVodField(item: VodSearchResult | undefined, key: string): string | undefined {
  if (!item || !isRecord(item.raw)) {
    return undefined
  }

  const value = getString(item.raw[key])
  return value.length > 0 ? value : undefined
}

function createRecentPlayInput(
  item: VodSearchResult,
  lineName: string,
  episodeName: string,
  episodeUrl: string,
  progress: { currentTime: number; duration: number },
): RecentPlayInput {
  return {
    id: createRecordId('recent', normalizeTitle(item.title)),
    sourceId: item.sourceId,
    sourceName: item.sourceName,
    vodId: item.vodId,
    title: item.title,
    poster: item.poster,
    lineName,
    episodeName,
    episodeUrl,
    currentTime: Math.max(0, Math.floor(progress.currentTime)),
    duration: Math.max(0, Math.floor(progress.duration)),
    rawJson: item.rawJson ?? stringifyRaw(item.raw),
    playedAt: Date.now(),
  }
}

function createFavoriteInput(item: VodSearchResult): FavoriteInput {
  return {
    id: createRecordId(item.sourceId, item.vodId),
    sourceId: item.sourceId,
    sourceName: item.sourceName,
    sourceUrl: item.sourceUrl,
    vodId: item.vodId,
    title: item.title,
    poster: item.poster,
    year: item.year,
    area: item.area,
    language: item.language,
    category: item.category,
    remarks: item.remarks,
    actor: item.actor,
    director: item.director,
    description: item.description,
    rawJson: item.rawJson ?? stringifyRaw(item.raw),
  }
}

function createRecordId(...parts: string[]): string {
  return parts.map((part) => encodeURIComponent(part)).join(':')
}

function stringifyRaw(value: unknown): string | undefined {
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, '').toLocaleLowerCase()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getString(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return ''
}

function getNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}
