import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, Loader2, Play, Radio, RefreshCw, Search, Tv } from 'lucide-react'
import { toast } from 'sonner'
import {
  LIVE_PLAYLIST_CACHE_PREFIX,
  LIVE_SELECTED_SOURCE_STORAGE_KEY,
  LIVE_SELECTION_STORAGE_PREFIX,
} from '@shared/constants'
import type { LiveChannel, LivePlaylist, LiveSourceConfig } from '@shared/types'
import { BasicPlayer } from '@renderer/components'
import { cn } from '@renderer/utils/cn'
import { getMediaProxyBaseUrl, isApiAvailable, listLiveSources, loadLivePlaylist } from '@renderer/services/api'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select'

const LIVE_CONTEXT_KEYWORDS = ['直播', '卫视', '央视', '央卫视']
const VOD_CONTEXT_KEYWORDS = ['点播', '录播', '回放']

interface LiveSelectionCache {
  channelId: string
  streamId: string
  expandedGroups: string[]
}

export function LivePage(): React.JSX.Element {
  const [liveSources, setLiveSources] = useState<LiveSourceConfig[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState('')
  const [playlist, setPlaylist] = useState<LivePlaylist>()
  const [activeChannelId, setActiveChannelId] = useState('')
  const [activeStreamId, setActiveStreamId] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set())
  const [keyword, setKeyword] = useState('')
  const [liveProxyBaseUrl, setLiveProxyBaseUrl] = useState('')
  const [isLoadingSettings, setIsLoadingSettings] = useState(true)
  const [isLoadingPlaylist, setIsLoadingPlaylist] = useState(false)
  const [isTheaterMode, setIsTheaterMode] = useState(false)
  const selectedSource = liveSources.find((source) => source.id === selectedSourceId)
  const activeChannel = playlist?.channels.find((channel) => channel.id === activeChannelId)
  const activeStream =
    activeChannel?.streams.find((stream) => stream.id === activeStreamId) ?? activeChannel?.streams[0]
  const activeStreamIndex = activeChannel?.streams.findIndex((stream) => stream.id === activeStreamId) ?? -1
  const hasPreviousStream = activeStreamIndex > 0
  const hasNextStream =
    activeChannel != null && activeStreamIndex >= 0 && activeStreamIndex < activeChannel.streams.length - 1
  const activeStreamUrl = activeStream?.url ?? ''
  const activeStreamIsHls = isLikelyHlsStream(activeStreamUrl)
  const activeStreamIsFlv = isLikelyFlvStream(activeStreamUrl)
  const activeStreamIsLive = activeStream?.isLive === true
  const playerSrc = resolveStreamPlaybackUrl(liveProxyBaseUrl, activeStreamUrl)
  const playerTitle = activeChannel?.title
  const formatPlaybackUrl = (currentSrc: string): string => activeStreamUrl || currentSrc
  const groupedChannels = useMemo(() => groupChannels(playlist?.channels ?? [], keyword), [keyword, playlist])
  const channelCount = playlist?.channels.length ?? 0
  const streamCount = playlist?.channels.reduce((total, channel) => total + channel.streams.length, 0) ?? 0

  const applyPlaylist = useCallback((nextPlaylist: LivePlaylist, sourceId: string): void => {
    const normalizedPlaylist = normalizeLivePlaylist(nextPlaylist)
    const selection = resolveLiveSelection(normalizedPlaylist, readCachedSelection(sourceId))

    setPlaylist(normalizedPlaylist)
    setActiveChannelId(selection.channelId)
    setActiveStreamId(selection.streamId)
    setExpandedGroups(new Set(selection.expandedGroups))
  }, [])

  const loadPlaylist = useCallback(
    async ({ force = false, silent = false }: { force?: boolean; silent?: boolean } = {}): Promise<void> => {
      if (!selectedSource || !isApiAvailable()) {
        return
      }

      if (!force) {
        const cachedPlaylist = readCachedPlaylist(selectedSource)
        if (cachedPlaylist) {
          applyPlaylist(cachedPlaylist, selectedSource.id)
          return
        }
      }

      setIsLoadingPlaylist(true)
      try {
        const nextPlaylist = normalizeLivePlaylist(await loadLivePlaylist(selectedSource.url))

        writeCachedPlaylist(selectedSource, nextPlaylist)
        applyPlaylist(nextPlaylist, selectedSource.id)

        if (!silent) {
          toast.success('直播源加载完成', {
            description: `共 ${nextPlaylist.channels.length} 个频道`,
          })
        }
      } catch (error) {
        toast.error('直播源加载失败', {
          description: error instanceof Error ? error.message : String(error),
        })
      } finally {
        setIsLoadingPlaylist(false)
      }
    },
    [applyPlaylist, selectedSource],
  )

  useEffect(() => {
    let active = true

    void Promise.all([listLiveSources(), getMediaProxyBaseUrl()])
      .then(([sources, proxyBaseUrl]) => {
        if (!active) return
        const nextSources = sources.filter((source) => source.enabled)
        const storedSourceId = window.localStorage.getItem(LIVE_SELECTED_SOURCE_STORAGE_KEY)
        const initialSourceId = nextSources.some((source) => source.id === storedSourceId)
          ? (storedSourceId ?? '')
          : (nextSources[0]?.id ?? '')

        setLiveSources(nextSources)
        setLiveProxyBaseUrl(proxyBaseUrl)
        setSelectedSourceId((current) => current || initialSourceId)
      })
      .finally(() => {
        if (active) {
          setIsLoadingSettings(false)
        }
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (isLoadingSettings || !selectedSource || playlist?.sourceUrl === selectedSource.url) {
      return
    }

    queueMicrotask(() => {
      void loadPlaylist({ silent: true })
    })
  }, [isLoadingSettings, loadPlaylist, playlist?.sourceUrl, selectedSource])

  useEffect(() => {
    if (!selectedSourceId || !activeChannelId || !playlist) {
      return
    }

    writeCachedSelection(selectedSourceId, {
      channelId: activeChannelId,
      streamId: activeStreamId,
      expandedGroups: [...expandedGroups],
    })
  }, [activeChannelId, activeStreamId, expandedGroups, playlist, selectedSourceId])

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

  const selectChannel = (channel: LiveChannel): void => {
    setActiveChannelId(channel.id)
    setActiveStreamId(channel.streams[0]?.id ?? '')
  }

  const selectStreamByOffset = (offset: -1 | 1): void => {
    if (!activeChannel || activeStreamIndex < 0) {
      return
    }

    const nextIndex = activeStreamIndex + offset
    const nextStream = activeChannel.streams[nextIndex]
    if (!nextStream) {
      return
    }

    setActiveStreamId(nextStream.id)
  }

  const toggleGroup = (groupName: string): void => {
    setExpandedGroups((current) => {
      const nextGroups = new Set(current)
      if (nextGroups.has(groupName)) {
        nextGroups.delete(groupName)
      } else {
        nextGroups.add(groupName)
      }
      return nextGroups
    })
  }

  return (
    <div
      className={cn(
        isTheaterMode
          ? 'fixed inset-0 z-50 flex flex-col bg-black'
          : 'bg-background text-foreground min-h-screen overflow-y-auto p-3 sm:p-4 xl:h-screen xl:overflow-hidden',
      )}
    >
      <div
        className={cn(
          isTheaterMode
            ? 'flex min-h-0 flex-1 items-center justify-center'
            : 'mx-auto flex min-h-[calc(100vh-1.5rem)] max-w-[1760px] flex-col gap-3 sm:min-h-[calc(100vh-2rem)] sm:gap-4 xl:h-full xl:min-h-0',
        )}
      >
        {!isTheaterMode ? <NowPlayingTitle title={playerTitle} /> : null}
        <div
          className={cn(
            isTheaterMode
              ? 'aspect-video w-full max-w-[calc(100vh*16/9)]'
              : 'grid flex-1 grid-cols-1 gap-3 sm:gap-4 xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_420px]',
          )}
        >
          <section className={cn(isTheaterMode ? 'h-full w-full' : 'min-h-0')}>
            <div
              className={cn(
                'min-h-0 overflow-hidden bg-black',
                !isTheaterMode && 'aspect-video rounded-xl xl:aspect-auto xl:h-full',
                isTheaterMode && 'h-full',
              )}
            >
              <BasicPlayer
                autoPlay
                className={isTheaterMode ? undefined : 'h-full'}
                enableAdFilter={false}
                enableAutoNext={false}
                formatPlaybackUrl={formatPlaybackUrl}
                hasNextEpisode={hasNextStream}
                hasPreviousEpisode={hasPreviousStream}
                isTheaterMode={isTheaterMode}
                loop={!activeStreamIsLive}
                persistPlaybackSettings={false}
                navigationLabels={{ next: '下一线路', previous: '上一线路' }}
                sourceType={activeStreamIsHls ? 'hls' : activeStreamIsFlv ? 'flv' : undefined}
                src={playerSrc}
                title={playerTitle}
                variant={activeStreamIsLive ? 'live' : 'vod'}
                onNextEpisode={() => selectStreamByOffset(1)}
                onPreviousEpisode={() => selectStreamByOffset(-1)}
                onToggleTheaterMode={() => setIsTheaterMode((current) => !current)}
              />
            </div>
          </section>

          {!isTheaterMode ? (
            <aside className="flex min-h-[520px] flex-col gap-3 sm:gap-4 xl:min-h-0">
              <div className="border-border bg-card rounded-xl border px-3 py-3 sm:px-4 sm:py-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <Select
                      disabled={isLoadingSettings || liveSources.length === 0 || isLoadingPlaylist}
                      value={selectedSourceId || undefined}
                      onValueChange={(sourceId) => {
                        setSelectedSourceId(sourceId)
                        window.localStorage.setItem(LIVE_SELECTED_SOURCE_STORAGE_KEY, sourceId)
                        setPlaylist(undefined)
                        setActiveChannelId('')
                        setActiveStreamId('')
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="暂无直播源" />
                      </SelectTrigger>
                      <SelectContent position="popper" align="start">
                        <SelectGroup>
                          {liveSources.map((source) => (
                            <SelectItem key={source.id} value={source.id}>
                              {source.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    className="w-full sm:w-auto"
                    disabled={!selectedSource || isLoadingPlaylist}
                    onClick={() => void loadPlaylist({ force: true })}
                  >
                    {isLoadingPlaylist ? <RefreshCw className="animate-spin" size={16} /> : <Radio size={16} />}
                    {isLoadingPlaylist ? '加载中' : '加载'}
                  </Button>
                </div>
                <div className="text-muted-foreground mt-3 text-sm">
                  {channelCount} 个频道 · {streamCount} 条线路
                </div>
              </div>

              <div className="border-border bg-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border">
                <div className="border-border border-b p-3 sm:p-4">
                  <div className="border-input bg-background flex h-10 items-center gap-2 rounded-xl border px-3">
                    <Search className="text-muted-foreground shrink-0" size={17} />
                    <Input
                      className="h-full border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                      placeholder="搜索频道"
                      value={keyword}
                      onChange={(event) => setKeyword(event.target.value)}
                    />
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                  {groupedChannels.length > 0 ? (
                    <div className="flex flex-col p-3 sm:p-4">
                      {groupedChannels.map((group) => (
                        <section key={group.name} className="border-border border-b last:border-b-0">
                          <button
                            aria-expanded={expandedGroups.has(group.name)}
                            className="hover:bg-muted/70 focus-visible:ring-ring flex h-12 w-full items-center gap-2 rounded-lg px-2 text-left transition-colors outline-none focus-visible:ring-2"
                            type="button"
                            onClick={() => toggleGroup(group.name)}
                          >
                            <ChevronDown
                              className={cn(
                                'text-muted-foreground shrink-0 transition-transform',
                                expandedGroups.has(group.name) ? 'rotate-0' : '-rotate-90',
                              )}
                              size={16}
                            />
                            <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs font-semibold">
                              {group.name}
                            </span>
                            <span className="text-muted-foreground shrink-0 text-xs font-semibold">
                              {group.channels.length}
                            </span>
                          </button>
                          {expandedGroups.has(group.name) ? (
                            <div className="flex flex-col gap-1.5 pb-3">
                              {group.channels.map((channel) => (
                                <ChannelButton
                                  key={channel.id}
                                  active={channel.id === activeChannelId}
                                  channel={channel}
                                  onClick={() => selectChannel(channel)}
                                />
                              ))}
                            </div>
                          ) : null}
                        </section>
                      ))}
                    </div>
                  ) : (
                    <EmptyLiveState
                      isLoading={isLoadingPlaylist || isLoadingSettings}
                      hasSources={liveSources.length > 0}
                      hasPlaylist={Boolean(playlist)}
                    />
                  )}
                </div>

                {activeChannel && activeChannel.streams.length > 1 ? (
                  <div className="border-border bg-muted/40 border-t p-3 sm:p-4">
                    <div className="mb-2 text-xs font-semibold">线路</div>
                    <div className="flex flex-wrap gap-2">
                      {activeChannel.streams.map((stream) => (
                        <Button
                          key={stream.id}
                          size="sm"
                          variant={stream.id === activeStream?.id ? 'default' : 'outline'}
                          onClick={() => setActiveStreamId(stream.id)}
                        >
                          {stream.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function NowPlayingTitle({ title }: { title?: string }): React.JSX.Element {
  return (
    <div className="flex h-12 shrink-0 items-center pl-2 text-xl leading-6 font-semibold">
      <span className="truncate">正在播放：{title ?? '请选择频道'}</span>
    </div>
  )
}

function ChannelButton({
  active,
  channel,
  onClick,
}: {
  active: boolean
  channel: LiveChannel
  onClick: () => void
}): React.JSX.Element {
  const channelInitial = channel.title.trim().charAt(0).toUpperCase() || '台'

  return (
    <button
      className={cn(
        'focus-visible:ring-ring flex h-14 items-center gap-3 rounded-xl px-3 text-left transition-colors outline-none focus-visible:ring-2',
        active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-foreground',
      )}
      type="button"
      onClick={onClick}
    >
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg border text-sm font-bold',
          active
            ? 'border-primary-foreground/25 bg-primary-foreground/15 text-primary-foreground'
            : 'border-border bg-muted text-muted-foreground',
        )}
      >
        <span aria-hidden="true" className="leading-none">
          {channelInitial}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{channel.title}</span>
        <span className={cn('block truncate text-xs', active ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
          {channel.streams.length > 1 ? `${channel.streams.length} 条线路` : channel.group}
        </span>
      </span>
      <Play className="shrink-0" size={15} />
    </button>
  )
}

function EmptyLiveState({
  hasPlaylist,
  hasSources,
  isLoading,
}: {
  hasPlaylist: boolean
  hasSources: boolean
  isLoading: boolean
}): React.JSX.Element {
  const text = isLoading
    ? '正在加载'
    : !hasSources
      ? '请先在设置页添加直播源'
      : hasPlaylist
        ? '没有匹配的频道'
        : '选择直播源后点击加载'

  return (
    <div className="flex h-full min-h-[320px] items-center justify-center p-6 text-center">
      <div>
        {isLoading ? (
          <Loader2 className="text-muted-foreground mx-auto animate-spin" size={26} />
        ) : (
          <Tv className="text-muted-foreground mx-auto" size={28} />
        )}
        <div className="text-muted-foreground mt-3 text-sm font-semibold">{text}</div>
      </div>
    </div>
  )
}

function groupChannels(channels: LiveChannel[], keyword: string): Array<{ name: string; channels: LiveChannel[] }> {
  const normalizedKeyword = keyword.trim().toLowerCase()
  const groupMap = new Map<string, LiveChannel[]>()

  for (const channel of channels) {
    if (
      normalizedKeyword &&
      !channel.title.toLowerCase().includes(normalizedKeyword) &&
      !channel.group.toLowerCase().includes(normalizedKeyword)
    ) {
      continue
    }

    const items = groupMap.get(channel.group) ?? []
    items.push(channel)
    groupMap.set(channel.group, items)
  }

  return [...groupMap.entries()].map(([name, groupChannels]) => ({ name, channels: groupChannels }))
}

function getPlaylistCacheKey(source: LiveSourceConfig): string {
  return `${LIVE_PLAYLIST_CACHE_PREFIX}${source.id}`
}

function readCachedPlaylist(source: LiveSourceConfig): LivePlaylist | undefined {
  try {
    const rawValue = window.localStorage.getItem(getPlaylistCacheKey(source))
    if (!rawValue) {
      return undefined
    }

    const cachedPlaylist = JSON.parse(rawValue) as LivePlaylist
    if (cachedPlaylist.sourceUrl !== source.url || !Array.isArray(cachedPlaylist.channels)) {
      return undefined
    }

    return normalizeLivePlaylist(cachedPlaylist)
  } catch {
    return undefined
  }
}

function writeCachedPlaylist(source: LiveSourceConfig, playlist: LivePlaylist): void {
  try {
    window.localStorage.setItem(getPlaylistCacheKey(source), JSON.stringify(playlist))
    window.localStorage.setItem(LIVE_SELECTED_SOURCE_STORAGE_KEY, source.id)
  } catch {
    // Ignore storage quota/private mode failures; playback still works for the current session.
  }
}

function getSelectionCacheKey(sourceId: string): string {
  return `${LIVE_SELECTION_STORAGE_PREFIX}${sourceId}`
}

function readCachedSelection(sourceId: string): LiveSelectionCache | undefined {
  try {
    const rawValue = window.localStorage.getItem(getSelectionCacheKey(sourceId))
    if (!rawValue) {
      return undefined
    }

    const cachedSelection = JSON.parse(rawValue) as LiveSelectionCache
    if (
      typeof cachedSelection.channelId !== 'string' ||
      typeof cachedSelection.streamId !== 'string' ||
      !Array.isArray(cachedSelection.expandedGroups)
    ) {
      return undefined
    }

    return cachedSelection
  } catch {
    return undefined
  }
}

function writeCachedSelection(sourceId: string, selection: LiveSelectionCache): void {
  try {
    window.localStorage.setItem(getSelectionCacheKey(sourceId), JSON.stringify(selection))
  } catch {
    // Ignore storage quota/private mode failures; playback still works for the current session.
  }
}

function resolveLiveSelection(playlist: LivePlaylist, cached?: LiveSelectionCache): LiveSelectionCache {
  const firstChannel = playlist.channels[0]
  const fallback: LiveSelectionCache = {
    channelId: firstChannel?.id ?? '',
    streamId: firstChannel?.streams[0]?.id ?? '',
    expandedGroups: firstChannel?.group ? [firstChannel.group] : [],
  }

  if (!cached) {
    return fallback
  }

  const channel = playlist.channels.find((item) => item.id === cached.channelId) ?? firstChannel
  if (!channel) {
    return fallback
  }

  const stream = channel.streams.find((item) => item.id === cached.streamId) ?? channel.streams[0]
  const knownGroups = new Set(playlist.channels.map((item) => item.group))
  const expandedGroups = cached.expandedGroups.filter((group) => knownGroups.has(group))

  return {
    channelId: channel.id,
    streamId: stream?.id ?? '',
    expandedGroups:
      expandedGroups.length > 0
        ? expandedGroups.includes(channel.group)
          ? expandedGroups
          : [...expandedGroups, channel.group]
        : [channel.group],
  }
}

function normalizeLivePlaylist(playlist: LivePlaylist): LivePlaylist {
  return {
    ...playlist,
    channels: playlist.channels.map((channel) => ({
      ...channel,
      streams: channel.streams.map((stream) => ({
        ...stream,
        isLive: inferStreamIsLive(channel.group, channel.title, stream.url),
      })),
    })),
  }
}

function resolveStreamPlaybackUrl(proxyBaseUrl: string, url: string | undefined): string | undefined {
  if (!url) {
    return undefined
  }

  if (!proxyBaseUrl) {
    return url
  }

  return resolveLivePlaybackUrl(proxyBaseUrl, url)
}

function resolveLivePlaybackUrl(proxyBaseUrl: string, url: string | undefined): string | undefined {
  if (!proxyBaseUrl || !url) {
    return undefined
  }

  try {
    const targetUrl = new URL(url)
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      return url
    }

    const proxyUrl = new URL('/media', proxyBaseUrl)
    proxyUrl.searchParams.set('url', targetUrl.toString())
    proxyUrl.searchParams.set('referer', `${targetUrl.origin}/`)
    return proxyUrl.toString()
  } catch {
    return url
  }
}

function inferStreamIsLive(group: string, title: string, url: string): boolean {
  const context = `${group} ${title}`
  if (VOD_CONTEXT_KEYWORDS.some((keyword) => context.includes(keyword))) {
    return false
  }

  if (isVodStreamUrl(url)) {
    return false
  }

  if (LIVE_CONTEXT_KEYWORDS.some((keyword) => context.includes(keyword))) {
    return true
  }

  return true
}

function isVodStreamUrl(url: string): boolean {
  return /\.(?:mp4|m4v|mkv|mov|avi|wmv|webm)(?:$|[?#])/i.test(url)
}

function isLikelyHlsStream(url: string | undefined): boolean {
  if (!url) {
    return false
  }

  try {
    const parsedUrl = new URL(url)
    return /\.m3u8(?:$|[?#])/i.test(parsedUrl.pathname) || /(?:^|[/?&=])(?:m3u8|hls|iptv|tvod)(?:$|[/?&=])/i.test(url)
  } catch {
    return /\.m3u8(?:$|[?#])/i.test(url)
  }
}

function isLikelyFlvStream(url: string | undefined): boolean {
  if (!url) {
    return false
  }

  try {
    const parsedUrl = new URL(url)
    return /\.flv(?:$|[?#])/i.test(parsedUrl.pathname) || isKnownFlvProxyUrl(parsedUrl)
  } catch {
    return /\.flv(?:$|[?#])/i.test(url) || /(?:^|\.)yg\.ygbox\.de5\.net\/huya\.php\?/i.test(url)
  }
}

function isKnownFlvProxyUrl(url: URL): boolean {
  return url.hostname === 'yg.ygbox.de5.net' && url.pathname === '/huya.php' && url.searchParams.has('id')
}
