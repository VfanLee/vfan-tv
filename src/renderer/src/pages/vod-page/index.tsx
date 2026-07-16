import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { ArrowLeft, Heart, ListVideo, Radio } from 'lucide-react'
import type { VodSearchResult } from '@shared/types'
import { BasicPlayer, MediaPoster } from '@renderer/components'
import { cn } from '@/utils'
import { useSearchContextStore } from '@/stores'
import { EpisodesPanel, NowPlayingTitle, PanelTab, SourcesPanel, VodDetailPanel } from './components/vod-panels'
import { useRecentPlayback } from './hooks/use-recent-playback'
import { useVodFavorite } from './hooks/use-vod-favorite'
import { useVodPageHydration } from './hooks/use-vod-page-hydration'
import { useVodSourceDiscovery } from './hooks/use-vod-source-discovery'
import type { EpisodeSelection, PlayerLocationState, PlayerTab } from './types'
import {
  dedupeCandidates,
  getDefaultSelection,
  getDoubanScore,
  getEpisodeCount,
  getPlayLines,
  getSelectionByEpisodeUrl,
  getSelectionByIndexes,
  getVodDetailItems,
  getVodField,
  normalizeTitle,
  shouldApplyLocationInitialTime,
} from './utils'

export function VodPage(): React.JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const { sourceId, vodId } = useParams()
  const candidates = useSearchContextStore((state) => state.candidates)
  const keyword = useSearchContextStore((state) => state.keyword)
  const [activeTab, setActiveTab] = useState<PlayerTab>('episodes')
  const [isEpisodeDescending, setIsEpisodeDescending] = useState(false)
  const [selection, setSelection] = useState<EpisodeSelection>()
  const [isTheaterMode, setIsTheaterMode] = useState(false)
  const routeLocationState = location.state as PlayerLocationState | null

  const provisionalCurrent = useMemo(
    () => candidates.find((item) => item.sourceId === sourceId && item.vodId === vodId),
    [candidates, sourceId, vodId],
  )
  const hydration = useVodPageHydration(sourceId, vodId, Boolean(provisionalCurrent), routeLocationState)
  const locationState = hydration.restoredLocationState

  const current = provisionalCurrent
  const resourceKey = `${sourceId ?? ''}:${vodId ?? ''}`
  const favorite = useVodFavorite(current, resourceKey)
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
  const recentPlayback = useRecentPlayback(current, activeLine, activeEpisode)
  const playbackProgressRef = recentPlayback.progressRef
  const saveRecentProgress = recentPlayback.save
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
  const sourceDiscovery = useVodSourceDiscovery({
    activeSelection,
    current,
    currentTitleKey,
    locationState,
    sameTitleCandidates,
    sourceRows,
  })
  const { isRefreshingSources, sourceProbeStates, refreshState, probeSources, refreshSources } = sourceDiscovery
  const openSourcesTab = (): void => {
    setActiveTab('sources')
    sourceDiscovery.openSources()
  }
  const detailItems = useMemo(() => getVodDetailItems(current), [current])
  const doubanScore = getDoubanScore(current)
  const remarks = getVodField(current, 'vod_remarks') ?? current?.remarks
  const vodStatus = getVodField(current, 'vod_state')
  const subtitle = getVodField(current, 'vod_sub')
  const isCurrentFavorite = favorite.isCurrentFavorite
  const isFavoriteLoading = favorite.isLoading
  const toggleFavorite = favorite.toggle
  const metaText = current
    ? [current.year, current.area, current.category].filter(Boolean).join(' · ')
    : hydration.isHydrating
      ? '正在恢复播放详情…'
      : '未找到该资源详情，请从搜索、最近播放或收藏重新进入。'

  const selectSource = (item: VodSearchResult): void => {
    const targetLines = getPlayLines(item)
    const preferredLineIndex = Math.min(activeSelection.lineIndex, Math.max(0, targetLines.length - 1))
    const targetLine = targetLines[preferredLineIndex]
    const preferredEpisodeIndex = Math.min(
      activeSelection.episodeIndex,
      Math.max(0, (targetLine?.episodes.length ?? 1) - 1),
    )

    navigate(`/vod/${item.sourceId}/${item.vodId}`, {
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
    navigate(`/vod/${sourceId}/${vodId}`, {
      replace: true,
      state: {
        preferredEpisodeIndex: episodeIndex,
        preferredLineIndex: activeSelection.lineIndex,
      } satisfies PlayerLocationState,
    })
  }

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
          : 'bg-background text-foreground min-h-screen overflow-y-auto px-8 pb-6',
      )}
    >
      {isTheaterMode ? (
        <div className="min-h-0 flex-1">
          <main className="flex h-full min-h-0 min-w-0 items-center justify-center">
            <section className="aspect-video w-full max-w-[calc(100vh*16/9)] overflow-hidden bg-black">
              <BasicPlayer
                autoPlay
                hasNextEpisode={hasNextEpisode}
                hasPreviousEpisode={hasPreviousEpisode}
                initialTime={initialTime}
                isResolvingSource={hydration.isHydrating}
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
        </div>
      ) : (
        <>
          <section className="h-screen py-5">
            <div className="flex h-full flex-col gap-6">
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

              <div className="grid min-h-0 flex-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
                <main className="min-h-0 min-w-0">
                  <section className="h-full min-h-0 overflow-hidden rounded-xl bg-black">
                    <BasicPlayer
                      autoPlay
                      className="h-full"
                      hasNextEpisode={hasNextEpisode}
                      hasPreviousEpisode={hasPreviousEpisode}
                      initialTime={initialTime}
                      isResolvingSource={hydration.isHydrating}
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

                <aside className="border-border bg-card flex min-h-0 flex-col rounded-xl border p-4 shadow-sm">
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
            </div>
          </section>

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
        </>
      )}
    </div>
  )
}
