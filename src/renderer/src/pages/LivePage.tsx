import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, Loader2, Play, Radio, RefreshCw, Search, Tv } from 'lucide-react'
import { toast } from 'sonner'
import type { LiveChannel, LivePlaylist, LiveSourceConfig } from '@shared/types'
import { resolveImageUrl } from '@shared/utils/media-image'
import { BasicPlayer } from '@renderer/components'
import { cn } from '@renderer/lib/utils'
import { getMediaProxyBaseUrl, isApiAvailable, listLiveSources, loadLivePlaylist } from '@renderer/services/api'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'

const LIVE_PLAYLIST_CACHE_PREFIX = 'vfantv-live-playlist:'
const LIVE_SELECTED_SOURCE_STORAGE_KEY = 'vfantv-live-selected-source-id'

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
  const selectedSource = liveSources.find((source) => source.id === selectedSourceId)
  const activeChannel = playlist?.channels.find((channel) => channel.id === activeChannelId)
  const activeStream =
    activeChannel?.streams.find((stream) => stream.id === activeStreamId) ?? activeChannel?.streams[0]
  const playerSrc = resolveLivePlaybackUrl(liveProxyBaseUrl, activeStream?.url)
  const activeStreamIsLive = isLikelyHlsStream(activeStream?.url)
  const groupedChannels = useMemo(() => groupChannels(playlist?.channels ?? [], keyword), [keyword, playlist])
  const channelCount = playlist?.channels.length ?? 0
  const streamCount = playlist?.channels.reduce((total, channel) => total + channel.streams.length, 0) ?? 0

  const applyPlaylist = useCallback((nextPlaylist: LivePlaylist): void => {
    const firstChannel = nextPlaylist.channels[0]
    const firstStream = firstChannel?.streams[0]

    setPlaylist(nextPlaylist)
    setActiveChannelId(firstChannel?.id ?? '')
    setActiveStreamId(firstStream?.id ?? '')
    setExpandedGroups(new Set(firstChannel?.group ? [firstChannel.group] : []))
  }, [])

  const loadPlaylist = useCallback(
    async ({ force = false, silent = false }: { force?: boolean; silent?: boolean } = {}): Promise<void> => {
      if (!selectedSource || !isApiAvailable()) {
        return
      }

      if (!force) {
        const cachedPlaylist = readCachedPlaylist(selectedSource)
        if (cachedPlaylist) {
          applyPlaylist(cachedPlaylist)
          return
        }
      }

      setIsLoadingPlaylist(true)
      try {
        const nextPlaylist = await loadLivePlaylist(selectedSource.url)

        writeCachedPlaylist(selectedSource, nextPlaylist)
        applyPlaylist(nextPlaylist)

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

  const selectChannel = (channel: LiveChannel): void => {
    setActiveChannelId(channel.id)
    setActiveStreamId(channel.streams[0]?.id ?? '')
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
    <div className="bg-background text-foreground h-screen overflow-hidden p-4">
      <div className="mx-auto grid h-full max-w-[1760px] grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="flex min-h-0 flex-col gap-4">
          <div className="border-border bg-card min-h-0 flex-1 overflow-hidden rounded-xl border">
            <BasicPlayer
              autoPlay
              className="h-full"
              loop={!activeStreamIsLive}
              src={playerSrc}
              sourceType={activeStreamIsLive ? 'hls' : undefined}
              title={activeChannel ? `正在播放：${activeChannel.title}` : undefined}
            />
          </div>
        </section>

        <aside className="flex min-h-0 flex-col gap-4">
          <div className="border-border bg-card rounded-xl border px-4 py-4">
            <div className="flex items-center gap-2">
              <select
                className="border-input bg-background text-foreground focus-visible:ring-ring h-10 min-w-0 flex-1 rounded-xl border px-3 text-sm outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isLoadingSettings || liveSources.length === 0 || isLoadingPlaylist}
                value={selectedSourceId}
                onChange={(event) => {
                  setSelectedSourceId(event.target.value)
                  window.localStorage.setItem(LIVE_SELECTED_SOURCE_STORAGE_KEY, event.target.value)
                  setPlaylist(undefined)
                  setActiveChannelId('')
                  setActiveStreamId('')
                }}
              >
                {liveSources.length === 0 ? <option value="">暂无直播源</option> : null}
                {liveSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </select>
              <Button
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
            <div className="border-border border-b p-4">
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
                <div className="flex flex-col p-4">
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
              <div className="border-border bg-muted/40 border-t p-4">
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
      </div>
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
  return (
    <button
      className={cn(
        'focus-visible:ring-ring flex h-14 items-center gap-3 rounded-xl px-3 text-left transition-colors outline-none focus-visible:ring-2',
        active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-foreground',
      )}
      type="button"
      onClick={onClick}
    >
      {channel.logo ? (
        <img
          alt=""
          className="bg-background/70 size-9 shrink-0 rounded-lg object-contain"
          loading="lazy"
          src={resolveImageUrl(channel.logo)}
        />
      ) : (
        <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
          <Tv size={16} />
        </span>
      )}
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

    return cachedPlaylist
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
    return proxyUrl.toString()
  } catch {
    return url
  }
}

function isLikelyHlsStream(url: string | undefined): boolean {
  if (!url) {
    return false
  }

  try {
    const parsedUrl = new URL(url)
    return (
      /\.m3u8(?:$|[?#])/i.test(parsedUrl.pathname) || /(?:^|[/?&=])(?:m3u8|hls|iptv|tvod|php)(?:$|[/?&=])/i.test(url)
    )
  } catch {
    return /\.m3u8(?:$|[?#])/i.test(url)
  }
}
