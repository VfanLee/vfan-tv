import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Hls from 'hls.js'
import { ChevronDown, Info, LoaderCircle, Pause, Play, Radio, Search, Volume2, VolumeX } from 'lucide-react'
import type { RadioCategory, RadioChannel, RadioLiveProgram, RadioRegion } from '@shared/types'
import {
  getMediaProxyBaseUrl,
  getRadioBillboard,
  getRadioCategories,
  getRadioCategoryChannels,
  getRadioChannelDetail,
  getRadioLivePrograms,
  getRadioRegions,
  searchRadioChannels,
} from '@renderer/services/api'
import { cn } from '@/utils'

type RadioView = 'discover' | 'ranking'

const PAGE_SIZE = 30

export function RadioPage(): React.JSX.Element {
  const [view, setView] = useState<RadioView>('discover')
  const [categories, setCategories] = useState<RadioCategory[]>([])
  const [regions, setRegions] = useState<RadioRegion[]>([])
  const [categoryId, setCategoryId] = useState(0)
  const [regionId, setRegionId] = useState(0)
  const [keyword, setKeyword] = useState('')
  const [channels, setChannels] = useState<RadioChannel[]>([])
  const [selectedChannel, setSelectedChannel] = useState<RadioChannel>()
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [proxyBaseUrl, setProxyBaseUrl] = useState('')
  const hasInitializedRef = useRef(false)

  const mergeLivePrograms = useCallback(async (items: RadioChannel[]): Promise<RadioChannel[]> => {
    if (!items.length) return items
    try {
      const programs = await getRadioLivePrograms(items.map((item) => item.id))
      return applyLivePrograms(items, programs)
    } catch {
      return items
    }
  }, [])

  const loadChannels = useCallback(
    async (
      nextView = view,
      nextCategoryId = categoryId,
      nextRegionId = regionId,
      nextKeyword = keyword,
    ): Promise<void> => {
      setIsLoading(true)
      setErrorMessage('')
      try {
        const normalizedKeyword = nextKeyword.trim()
        const items = normalizedKeyword
          ? (await searchRadioChannels(normalizedKeyword, 1, PAGE_SIZE)).items
          : nextView === 'ranking'
            ? await getRadioBillboard(nextCategoryId, nextRegionId)
            : await getRadioCategoryChannels(nextCategoryId, 1, PAGE_SIZE)
        const nextItems = await mergeLivePrograms(items)
        setChannels(nextItems)
      } catch (error) {
        const message = error instanceof Error ? error.message : '电台加载失败，请稍后重试。'
        setErrorMessage(message)
        setChannels([])
      } finally {
        setIsLoading(false)
      }
    },
    [categoryId, keyword, mergeLivePrograms, regionId, view],
  )

  useEffect(() => {
    if (hasInitializedRef.current) return
    hasInitializedRef.current = true
    let active = true
    void Promise.all([getRadioCategories(), getRadioRegions(), getMediaProxyBaseUrl()])
      .then(([nextCategories, nextRegions, nextProxyBaseUrl]) => {
        if (!active) return
        setCategories(nextCategories)
        setRegions(nextRegions)
        const initialCategoryId = nextCategories[0]?.id ?? 0
        const initialRegionId = nextRegions[0]?.id ?? 0
        setCategoryId(initialCategoryId)
        setRegionId(initialRegionId)
        void loadChannels('discover', initialCategoryId, initialRegionId, '')
        setProxyBaseUrl(nextProxyBaseUrl)
      })
      .catch((error: unknown) => {
        if (!active) return
        setErrorMessage(error instanceof Error ? error.message : '电台服务暂时不可用。')
        setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [loadChannels])

  useEffect(() => {
    if (!channels.length) return
    const refresh = (): void => {
      void getRadioLivePrograms(channels.map((item) => item.id))
        .then((programs) => setChannels((current) => applyLivePrograms(current, programs)))
        .catch(() => undefined)
    }
    const timer = window.setInterval(refresh, 45_000)
    return () => window.clearInterval(timer)
  }, [channels])

  const onViewChange = (nextView: RadioView): void => {
    setView(nextView)
    void loadChannels(nextView, categoryId, regionId, keyword)
  }

  const onCategoryChange = (nextCategoryId: number): void => {
    setCategoryId(nextCategoryId)
    void loadChannels(view, nextCategoryId, regionId, keyword)
  }

  const onRegionChange = (nextRegionId: number): void => {
    setRegionId(nextRegionId)
    void loadChannels('ranking', categoryId, nextRegionId, keyword)
  }

  const onSearch = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void loadChannels(view, categoryId, regionId, keyword)
  }

  const currentCategoryTitle = categories.find((item) => item.id === categoryId)?.title

  return (
    <div className="bg-background text-foreground min-h-full px-6 py-7 sm:px-10 sm:py-9">
      <div className="mx-auto grid max-w-[1540px] gap-7 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0">
          <header className="mb-7 flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <div className="bg-primary/12 text-primary flex size-11 items-center justify-center rounded-2xl">
                <Radio size={22} />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">电台</h1>
                <p className="text-muted-foreground mt-1 text-sm">在线收听音乐、资讯与地方广播</p>
              </div>
            </div>

            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div className="bg-muted flex w-fit rounded-xl p-1">
                <ViewButton active={view === 'discover'} onClick={() => onViewChange('discover')}>
                  发现电台
                </ViewButton>
                <ViewButton active={view === 'ranking'} onClick={() => onViewChange('ranking')}>
                  排行榜
                </ViewButton>
              </div>
              <form
                className="border-input bg-card flex h-11 max-w-md flex-1 items-center gap-2 rounded-xl border px-3"
                onSubmit={onSearch}
              >
                <Search className="text-muted-foreground size-4 shrink-0" />
                <input
                  aria-label="搜索电台"
                  className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
                  placeholder="搜索电台名称"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                />
                <button className="text-primary text-sm font-medium" type="submit">
                  搜索
                </button>
              </form>
            </div>

            {view === 'discover' ? (
              <div className="flex flex-wrap gap-2">
                {categories.map((item) => (
                  <button
                    key={item.id}
                    className={cn(
                      'rounded-full px-3.5 py-2 text-sm transition-colors',
                      categoryId === item.id
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                    type="button"
                    onClick={() => onCategoryChange(item.id)}
                  >
                    {item.title}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                <label className="text-muted-foreground flex items-center gap-2 text-sm">
                  分类
                  <select
                    className="border-input bg-card text-foreground h-9 rounded-lg border px-2 text-sm outline-none"
                    value={categoryId}
                    onChange={(event) => onCategoryChange(Number(event.target.value))}
                  >
                    <option value={0}>全国总榜</option>
                    {categories.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-muted-foreground flex items-center gap-2 text-sm">
                  地区
                  <select
                    className="border-input bg-card text-foreground h-9 rounded-lg border px-2 text-sm outline-none"
                    value={regionId}
                    onChange={(event) => onRegionChange(Number(event.target.value))}
                  >
                    {regions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </header>

          <section aria-live="polite">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold">
                {keyword.trim()
                  ? `“${keyword.trim()}” 的搜索结果`
                  : view === 'ranking'
                    ? '广播排行榜'
                    : `${currentCategoryTitle ?? '推荐'}电台`}
              </h2>
              {!isLoading ? <span className="text-muted-foreground text-sm">{channels.length} 个电台</span> : null}
            </div>

            {isLoading ? (
              <div className="border-input bg-card flex h-64 items-center justify-center rounded-2xl border">
                <LoaderCircle className="text-primary animate-spin" size={25} />
              </div>
            ) : errorMessage ? (
              <EmptyState description={errorMessage} onRetry={() => void loadChannels()} />
            ) : channels.length ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {channels.map((channel, index) => (
                  <ChannelCard
                    key={channel.id}
                    channel={channel}
                    rank={view === 'ranking' && !keyword.trim() ? index + 1 : undefined}
                    selected={selectedChannel?.id === channel.id}
                    onClick={() => setSelectedChannel(channel)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState description="没有找到匹配的电台。" onRetry={() => void loadChannels()} />
            )}
          </section>
        </section>

        <aside className="xl:sticky xl:top-7 xl:h-fit">
          <RadioPlayer channel={selectedChannel} proxyBaseUrl={proxyBaseUrl} />
        </aside>
      </div>
    </div>
  )
}

function ViewButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      className={cn(
        'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
        active && 'bg-background text-foreground shadow-sm',
      )}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function ChannelCard({
  channel,
  rank,
  selected,
  onClick,
}: {
  channel: RadioChannel
  rank?: number
  selected: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      className={cn(
        'border-input bg-card hover:border-primary/40 hover:bg-accent/40 group flex min-w-0 items-center gap-3 rounded-2xl border p-3 text-left transition-colors',
        selected && 'border-primary bg-primary/5',
      )}
      type="button"
      onClick={onClick}
    >
      {rank ? <span className="text-primary w-5 text-center text-sm font-bold">{rank}</span> : null}
      <RadioCover className="size-14 rounded-xl" coverUrl={channel.coverUrl} title={channel.title} />
      <span className="min-w-0 flex-1">
        <span className="text-foreground block truncate font-semibold">{channel.title}</span>
        <span className="text-muted-foreground mt-1 block truncate text-sm">
          {channel.nowPlayingTitle || '暂无节目单'}
        </span>
        <span className="text-muted-foreground mt-1 block text-xs">{formatAudience(channel.audienceCount)}</span>
      </span>
      <span className="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        <Play className="ml-0.5 size-4" fill="currentColor" />
      </span>
    </button>
  )
}

function RadioPlayer({ channel, proxyBaseUrl }: { channel?: RadioChannel; proxyBaseUrl: string }): React.JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [volume, setVolume] = useState(0.8)
  const [errorMessage, setErrorMessage] = useState('')
  const [loadedDetails, setLoadedDetails] = useState<RadioChannel>()
  const [isDetailsOpen, setIsDetailsOpen] = useState(true)
  const streamUrl = useMemo(() => (channel ? createRadioStreamUrl(channel.id) : ''), [channel])
  const playbackUrl = useMemo(() => createMediaProxyUrl(proxyBaseUrl, streamUrl), [proxyBaseUrl, streamUrl])

  useEffect(() => {
    if (!channel) return
    let active = true
    void getRadioChannelDetail(channel.id)
      .then((detail) => {
        if (active) setLoadedDetails(detail)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [channel])

  const details = channel && loadedDetails?.id === channel.id ? { ...channel, ...loadedDetails } : channel

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !playbackUrl) return
    hlsRef.current?.destroy()
    hlsRef.current = null
    setErrorMessage('')
    setIsLoading(true)

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true })
      hlsRef.current = hls
      hls.loadSource(playbackUrl)
      hls.attachMedia(audio)
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return
        setErrorMessage('电台播放失败，请稍后重试。')
        setIsLoading(false)
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad()
      })
    } else {
      audio.src = playbackUrl
    }

    void audio.play().catch(() => setErrorMessage('浏览器阻止了自动播放，请点击播放按钮。'))
    return () => {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
  }, [playbackUrl])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = volume
    audio.muted = isMuted
  }, [isMuted, volume])

  const togglePlayback = (): void => {
    const audio = audioRef.current
    if (!audio || !playbackUrl) return
    if (audio.paused) {
      void audio.play().catch(() => setErrorMessage('无法开始播放，请重试。'))
    } else {
      audio.pause()
    }
  }

  return (
    <section className="border-input bg-card overflow-hidden rounded-3xl border p-5 shadow-sm">
      <audio
        ref={audioRef}
        onCanPlay={() => setIsLoading(false)}
        onError={() => {
          setErrorMessage('音频加载失败，请切换电台后重试。')
          setIsLoading(false)
        }}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
      />
      <div className="bg-muted flex aspect-square items-center justify-center overflow-hidden rounded-2xl">
        {channel ? (
          <RadioCover className="size-full rounded-none" coverUrl={channel.coverUrl} title={channel.title} />
        ) : (
          <Radio className="text-muted-foreground size-16" />
        )}
      </div>
      <div className="mt-5 min-w-0 text-center">
        <h2 className="truncate text-lg font-semibold">{channel?.title ?? '选择一个电台开始收听'}</h2>
        <p className="text-muted-foreground mt-1 min-h-5 truncate text-sm">
          {channel?.nowPlayingTitle ?? '当前没有播放内容'}
        </p>
      </div>
      {errorMessage ? <p className="text-destructive mt-3 text-center text-xs">{errorMessage}</p> : null}
      <div className="mt-5 flex items-center justify-center gap-4">
        <button
          aria-label={isMuted ? '取消静音' : '静音'}
          className="text-muted-foreground hover:text-foreground disabled:opacity-40"
          disabled={!channel}
          type="button"
          onClick={() => setIsMuted((current) => !current)}
        >
          {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
        </button>
        <button
          aria-label={isPlaying ? '暂停播放' : '开始播放'}
          className="bg-primary text-primary-foreground hover:bg-primary/90 flex size-14 items-center justify-center rounded-full shadow-sm disabled:opacity-45"
          disabled={!channel}
          type="button"
          onClick={togglePlayback}
        >
          {isLoading ? (
            <LoaderCircle className="animate-spin" size={22} />
          ) : isPlaying ? (
            <Pause size={23} fill="currentColor" />
          ) : (
            <Play className="ml-0.5" size={23} fill="currentColor" />
          )}
        </button>
        <input
          aria-label="音量"
          className="accent-primary h-1 w-20 cursor-pointer disabled:opacity-40"
          disabled={!channel}
          max="1"
          min="0"
          step="0.05"
          type="range"
          value={isMuted ? 0 : volume}
          onChange={(event) => {
            const nextVolume = Number(event.target.value)
            setVolume(nextVolume)
            setIsMuted(nextVolume === 0)
          }}
        />
      </div>
      {details ? (
        <RadioDetails
          details={details}
          isOpen={isDetailsOpen}
          onToggle={() => setIsDetailsOpen((current) => !current)}
        />
      ) : null}
    </section>
  )
}

function RadioDetails({
  details,
  isOpen,
  onToggle,
}: {
  details: RadioChannel
  isOpen: boolean
  onToggle: () => void
}): React.JSX.Element {
  const metadata = [
    details.category?.title ? `分类 · ${details.category.title}` : undefined,
    details.region?.title ? `地区 · ${details.region.title}` : undefined,
    details.audienceCount ? formatAudience(details.audienceCount) : undefined,
  ].filter((item): item is string => Boolean(item))

  return (
    <section className="border-border mt-6 border-t pt-4">
      <button
        aria-expanded={isOpen}
        className="text-foreground hover:text-primary flex w-full items-center justify-between text-left text-sm font-semibold"
        type="button"
        onClick={onToggle}
      >
        <span className="flex items-center gap-2">
          <Info className="text-primary size-4" /> 电台信息
        </span>
        <ChevronDown className={cn('text-muted-foreground size-4 transition-transform', !isOpen && '-rotate-90')} />
      </button>
      {isOpen ? (
        <div className="animate-in fade-in-0 slide-in-from-top-1 mt-3 duration-200">
          {metadata.length ? (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {metadata.map((item) => (
                <span key={item} className="bg-muted text-muted-foreground rounded-full px-2.5 py-1 text-xs">
                  {item}
                </span>
              ))}
            </div>
          ) : null}
          <p className="text-muted-foreground text-sm leading-6">{details.description || '该电台暂未提供详细介绍。'}</p>
        </div>
      ) : null}
    </section>
  )
}

function RadioCover({
  className,
  coverUrl,
  title,
}: {
  className: string
  coverUrl?: string
  title: string
}): React.JSX.Element {
  if (coverUrl) return <img alt="" className={cn('bg-muted object-cover', className)} src={coverUrl} />
  return (
    <div aria-label={title} className={cn('bg-primary/10 text-primary flex items-center justify-center', className)}>
      <Radio size={22} />
    </div>
  )
}

function EmptyState({ description, onRetry }: { description: string; onRetry: () => void }): React.JSX.Element {
  return (
    <div className="border-input bg-card flex h-64 flex-col items-center justify-center rounded-2xl border">
      <Radio className="text-muted-foreground size-8" />
      <p className="text-muted-foreground mt-3 text-sm">{description}</p>
      <button className="text-primary mt-3 text-sm font-medium" type="button" onClick={onRetry}>
        重试
      </button>
    </div>
  )
}

function applyLivePrograms(channels: RadioChannel[], programs: RadioLiveProgram[]): RadioChannel[] {
  const titleByChannelId = new Map(programs.map((program) => [program.channelId, program.title]))
  return channels.map((channel) => ({
    ...channel,
    nowPlayingTitle: titleByChannelId.get(channel.id) || channel.nowPlayingTitle,
  }))
}

function createRadioStreamUrl(channelId: number): string {
  return `https://ls.qingting.fm/live/${channelId}/64k.m3u8`
}

function createMediaProxyUrl(proxyBaseUrl: string, sourceUrl: string): string {
  if (!proxyBaseUrl || !sourceUrl) return sourceUrl
  const proxyUrl = new URL('/media', proxyBaseUrl)
  proxyUrl.searchParams.set('url', sourceUrl)
  proxyUrl.searchParams.set('referer', `${new URL(sourceUrl).origin}/`)
  return proxyUrl.toString()
}

function formatAudience(value: number | undefined): string {
  if (!value) return '正在直播'
  return value >= 10_000 ? `${(value / 10_000).toFixed(1)} 万人收听` : `${value.toLocaleString()} 人收听`
}
