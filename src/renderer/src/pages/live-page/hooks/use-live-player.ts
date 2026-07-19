import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { LIVE_SELECTED_SOURCE_STORAGE_KEY } from '@shared/constants'
import type { LiveChannel, LiveChannelStream, LivePlaylist, LiveSourceConfig, MediaStreamType } from '@shared/types'
import {
  detectMediaStreamType,
  getMediaProxyBaseUrl,
  isApiAvailable,
  listLiveSources,
  loadLivePlaylist,
} from '@renderer/services/api'
import {
  getStreamTypeCacheKey,
  groupChannels,
  getKnownStreamType,
  normalizeLivePlaylist,
  readCachedPlaylist,
  readCachedSelection,
  readCachedStreamTypes,
  resolveLiveSelection,
  resolveStreamPlaybackUrl,
  writeCachedPlaylist,
  writeCachedSelection,
  writeCachedStreamTypes,
} from '../utils'

export interface LivePlayerState {
  activeChannel?: LiveChannel
  activeChannelId: string
  activeStream?: LiveChannelStream
  activeStreamType?: MediaStreamType
  channelCount: number
  expandedGroups: Set<string>
  formatPlaybackUrl: (currentSrc: string) => string
  groupedChannels: Array<{ name: string; channels: LiveChannel[] }>
  hasNextStream: boolean
  hasPreviousStream: boolean
  isLoadingPlaylist: boolean
  isLoadingSettings: boolean
  isResolvingStreamType: boolean
  isTheaterMode: boolean
  keyword: string
  liveSources: LiveSourceConfig[]
  playerSrc?: string
  playerTitle?: string
  playlist?: LivePlaylist
  selectedSource?: LiveSourceConfig
  selectedSourceId: string
  streamCount: number
  variant: 'live' | 'vod'
  loadPlaylist: (options?: { force?: boolean; silent?: boolean }) => Promise<void>
  selectChannel: (channel: LiveChannel) => void
  selectSource: (sourceId: string) => void
  selectStreamByOffset: (offset: -1 | 1) => void
  setActiveStreamId: (streamId: string) => void
  setIsTheaterMode: React.Dispatch<React.SetStateAction<boolean>>
  setKeyword: (keyword: string) => void
  toggleGroup: (groupName: string) => void
}

export function useLivePlayer(): LivePlayerState {
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
  const [detectedStream, setDetectedStream] = useState<{ url: string; type: MediaStreamType }>()
  const [streamTypeCache, setStreamTypeCache] = useState<Record<string, MediaStreamType>>(() => readCachedStreamTypes())
  const selectedSource = liveSources.find((source) => source.id === selectedSourceId)
  const activeChannel = playlist?.channels.find((channel) => channel.id === activeChannelId)
  const activeStream =
    activeChannel?.streams.find((stream) => stream.id === activeStreamId) ?? activeChannel?.streams[0]
  const activeStreamIndex = activeChannel?.streams.findIndex((stream) => stream.id === activeStreamId) ?? -1
  const activeStreamUrl = activeStream?.url ?? ''
  const knownStreamType = getKnownStreamType(activeStreamUrl)
  const streamTypeCacheKey =
    selectedSource && activeChannel && activeStream
      ? getStreamTypeCacheKey(selectedSource, activeChannel, activeStream)
      : ''
  const cachedStreamType = streamTypeCache[streamTypeCacheKey]
  const activeStreamType =
    knownStreamType ??
    cachedStreamType ??
    (detectedStream?.url === activeStreamUrl ? detectedStream.type : undefined) ??
    (activeStreamUrl && !isApiAvailable() ? 'native' : undefined)
  const isResolvingStreamType = Boolean(activeStreamUrl && !activeStreamType)
  const groupedChannels = useMemo(() => groupChannels(playlist?.channels ?? [], keyword), [keyword, playlist])

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
      if (!selectedSource || !isApiAvailable()) return
      const cachedPlaylist = readCachedPlaylist(selectedSource)
      if (cachedPlaylist) {
        applyPlaylist(cachedPlaylist, selectedSource.id)
        if (!force) return
      }
      setIsLoadingPlaylist(true)
      try {
        const nextPlaylist = normalizeLivePlaylist(await loadLivePlaylist(selectedSource.url))
        writeCachedPlaylist(selectedSource, nextPlaylist)
        applyPlaylist(nextPlaylist, selectedSource.id)
        if (!silent) {
          toast.success('直播源加载完成', { description: `共 ${nextPlaylist.channels.length} 个频道` })
        }
      } catch (error) {
        toast.error('直播源加载失败', { description: error instanceof Error ? error.message : String(error) })
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
        if (active) setIsLoadingSettings(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (isLoadingSettings || !selectedSource || playlist?.sourceUrl === selectedSource.url) return
    queueMicrotask(() => void loadPlaylist({ force: true, silent: true }))
  }, [isLoadingSettings, loadPlaylist, playlist?.sourceUrl, selectedSource])

  useEffect(() => {
    if (!selectedSourceId || !activeChannelId || !playlist) return
    writeCachedSelection(selectedSourceId, {
      channelId: activeChannelId,
      streamId: activeStreamId,
      expandedGroups: [...expandedGroups],
    })
  }, [activeChannelId, activeStreamId, expandedGroups, playlist, selectedSourceId])

  useEffect(() => {
    if (!isTheaterMode) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsTheaterMode(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isTheaterMode])

  useEffect(() => {
    if (!activeStreamUrl || knownStreamType || cachedStreamType || !isApiAvailable()) return

    let active = true
    void detectMediaStreamType({
      url: activeStreamUrl,
      referer: activeStream?.requestHeaders?.referer,
      userAgent: activeStream?.requestHeaders?.userAgent,
    }).then((result) => {
      if (!active || !result) return
      // 探测因超时/网络错误被动降级为 native 时不写入本地缓存，
      // 以便下次访问该频道时仍有机会重新探测出真实的流类型。
      if (!result.uncertain) {
        setStreamTypeCache((current) => {
          const nextCache = { ...current, [streamTypeCacheKey]: result.type }
          writeCachedStreamTypes(nextCache)
          return nextCache
        })
      }
      setDetectedStream({ url: activeStreamUrl, type: result.type })
    })
    return () => {
      active = false
    }
  }, [
    activeStream?.requestHeaders?.referer,
    activeStream?.requestHeaders?.userAgent,
    activeStreamUrl,
    cachedStreamType,
    knownStreamType,
    streamTypeCacheKey,
  ])

  const selectSource = (sourceId: string): void => {
    setSelectedSourceId(sourceId)
    window.localStorage.setItem(LIVE_SELECTED_SOURCE_STORAGE_KEY, sourceId)
    setPlaylist(undefined)
    setActiveChannelId('')
    setActiveStreamId('')
  }

  const selectChannel = (channel: LiveChannel): void => {
    setActiveChannelId(channel.id)
    setActiveStreamId(channel.streams[0]?.id ?? '')
  }

  const selectStreamByOffset = (offset: -1 | 1): void => {
    if (!activeChannel || activeStreamIndex < 0) return
    const nextStream = activeChannel.streams[activeStreamIndex + offset]
    if (nextStream) setActiveStreamId(nextStream.id)
  }

  const toggleGroup = (groupName: string): void => {
    setExpandedGroups(groupName ? new Set([groupName]) : new Set())
  }

  return {
    activeChannel,
    activeChannelId,
    activeStream,
    activeStreamType,
    expandedGroups,
    groupedChannels,
    hasNextStream:
      activeChannel != null && activeStreamIndex >= 0 && activeStreamIndex < activeChannel.streams.length - 1,
    hasPreviousStream: activeStreamIndex > 0,
    isLoadingPlaylist,
    isLoadingSettings,
    isResolvingStreamType,
    isTheaterMode,
    keyword,
    liveSources,
    playerSrc: activeStreamType
      ? resolveStreamPlaybackUrl(liveProxyBaseUrl, activeStreamUrl, activeStream?.requestHeaders)
      : undefined,
    playerTitle: activeChannel?.title,
    playlist,
    selectedSource,
    selectedSourceId,
    channelCount: playlist?.channels.length ?? 0,
    streamCount: playlist?.channels.reduce((total, channel) => total + channel.streams.length, 0) ?? 0,
    formatPlaybackUrl: (currentSrc: string): string => activeStreamUrl || currentSrc,
    loadPlaylist,
    selectChannel,
    selectSource,
    selectStreamByOffset,
    setActiveStreamId,
    setIsTheaterMode,
    setKeyword,
    toggleGroup,
    variant: activeStream?.isLive === true ? ('live' as const) : ('vod' as const),
  }
}
