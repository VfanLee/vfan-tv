import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import {
  AudioLines,
  LoaderCircle,
  Pause,
  PictureInPicture2,
  Play,
  Radio,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { toast } from 'sonner'
import type { RadioChannel } from '@shared/types'
import { resolveImageUrl } from '@shared/utils/media-image'
import {
  enterMiniWindowMode,
  getMediaProxyBaseUrl,
  getRadioChannelDetail,
  getRadioLivePrograms,
  isApiAvailable,
  onMiniWindowModeExit,
} from '@renderer/services/api'
import radioPlayerBackgroundUrl from '@renderer/assets/radio-player-background.png'
import radioPlayerBackgroundDarkUrl from '@renderer/assets/radio-player-background-dark.png'
import { useRadioPlayerStore } from '@/stores'
import type { RadioPlaybackCommand, RadioPlaybackStatus } from '@/stores/radio-player'
import { cn, createMediaPlaybackCoordinator } from '@/utils'

const PROGRAM_REFRESH_INTERVAL = 45_000

export function RadioPlaybackEngine(): React.JSX.Element {
  const channel = useRadioPlayerStore((state) => state.channel)
  const command = useRadioPlayerStore((state) => state.command)
  const commandId = useRadioPlayerStore((state) => state.commandId)
  const isMuted = useRadioPlayerStore((state) => state.isMuted)
  const volume = useRadioPlayerStore((state) => state.volume)

  useRadioProgramRefresh(channel?.id, (title) => {
    useRadioPlayerStore.getState().setChannelProgram(title)
  })

  useEffect(
    () => () => {
      useRadioPlayerStore.getState().pauseForExternalMedia()
    },
    [],
  )

  return (
    <RadioStreamEngine
      channel={channel}
      command={command}
      commandId={commandId}
      isMuted={isMuted}
      volume={volume}
      onError={(message) => useRadioPlayerStore.getState().setError(message)}
      onStatusChange={(status) => useRadioPlayerStore.getState().setStatus(status)}
    />
  )
}

export function RadioStreamEngine({
  channel,
  command,
  commandId,
  isMuted,
  onError,
  onStatusChange,
  volume,
}: {
  channel?: RadioChannel
  command: RadioPlaybackCommand
  commandId: number
  isMuted: boolean
  onError: (message: string) => void
  onStatusChange: (status: RadioPlaybackStatus) => void
  volume: number
}): React.JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const loadedChannelIdRef = useRef<number | undefined>(undefined)
  const statusRef = useRef<RadioPlaybackStatus>('idle')
  const channelRef = useRef(channel)
  const commandRef = useRef(command)
  const callbacksRef = useRef({ onError, onStatusChange })
  const [proxyBaseUrl, setProxyBaseUrl] = useState('')

  useEffect(() => {
    channelRef.current = channel
    commandRef.current = command
    callbacksRef.current = { onError, onStatusChange }
  }, [channel, command, onError, onStatusChange])

  const reportStatus = (status: RadioPlaybackStatus): void => {
    statusRef.current = status
    callbacksRef.current.onStatusChange(status)
  }

  const reportError = (message: string): void => {
    statusRef.current = 'error'
    callbacksRef.current.onError(message)
  }

  useEffect(() => {
    let active = true
    void getMediaProxyBaseUrl()
      .then((baseUrl) => {
        if (active) setProxyBaseUrl(baseUrl)
      })
      .catch(() => {
        if (active) reportError('本地音频代理未就绪，请重试。')
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const pauseForExternalMedia = (): void => {
      audio.pause()
      reportStatus('paused')
    }
    const playbackCoordinator = createMediaPlaybackCoordinator('radio', pauseForExternalMedia)
    const onPlay = (): void => {
      reportStatus('playing')
      playbackCoordinator.announcePlaying()
    }
    const onPause = (): void => {
      if (statusRef.current === 'playing') reportStatus('paused')
    }
    const onError = (): void => {
      reportError('播放失败，请重试。')
    }
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('error', onError)

    return () => {
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('error', onError)
      playbackCoordinator.dispose()
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = volume
    audio.muted = isMuted
  }, [isMuted, volume])

  useEffect(() => {
    if (!commandId) return
    const audio = audioRef.current
    if (!audio) return
    const currentChannel = channelRef.current
    const currentCommand = commandRef.current

    if (currentCommand === 'pause') {
      audio.pause()
      reportStatus('paused')
      return
    }
    if (currentCommand === 'stop') {
      teardownPlayback(audio, hlsRef)
      loadedChannelIdRef.current = undefined
      reportStatus('paused')
      return
    }
    if (!currentChannel || !['play', 'retry'].includes(currentCommand)) return
    if (!proxyBaseUrl) {
      reportError('本地音频代理未就绪，请重试。')
      return
    }

    const resumeLoadedChannel =
      currentCommand === 'play' && loadedChannelIdRef.current === currentChannel.id && Boolean(audio.currentSrc)
    if (resumeLoadedChannel) {
      void audio.play().catch(() => reportError('无法开始播放，请重试。'))
      return
    }

    teardownPlayback(audio, hlsRef)
    loadedChannelIdRef.current = currentChannel.id
    const playbackUrl = createMediaProxyUrl(proxyBaseUrl, createRadioStreamUrl(currentChannel.id))
    reportStatus('loading')

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true })
      hlsRef.current = hls
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        void audio.play().catch(() => reportError('无法开始播放，请重试。'))
      })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) reportError('播放失败，请重试。')
      })
      hls.loadSource(playbackUrl)
      hls.attachMedia(audio)
    } else {
      audio.src = playbackUrl
      void audio.play().catch(() => reportError('无法开始播放，请重试。'))
    }
  }, [commandId, proxyBaseUrl])

  useEffect(() => {
    const audio = audioRef.current
    return () => {
      if (audio) teardownPlayback(audio, hlsRef)
    }
  }, [])

  return <audio ref={audioRef} aria-hidden="true" className="hidden" />
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRadioProgramRefresh(channelId: number | undefined, onProgram: (title: string) => void): void {
  const onProgramRef = useRef(onProgram)

  useEffect(() => {
    onProgramRef.current = onProgram
  }, [onProgram])

  useEffect(() => {
    if (!channelId) return
    let active = true
    const refreshProgram = (): void => {
      void getRadioLivePrograms([channelId])
        .then(([program]) => {
          if (active && program?.title) onProgramRef.current(program.title)
        })
        .catch(() => undefined)
    }
    refreshProgram()
    const timer = window.setInterval(refreshProgram, PROGRAM_REFRESH_INTERVAL)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [channelId])
}

export function RadioPlayerPanel(): React.JSX.Element {
  const channel = useRadioPlayerStore((state) => state.channel)
  const [channelDetails, setChannelDetails] = useState<RadioChannel>()
  const channelId = channel?.id

  useEffect(() => {
    if (!channelId) return

    let active = true
    void getRadioChannelDetail(channelId)
      .then((details) => {
        if (active) setChannelDetails(details)
      })
      .catch(() => undefined)

    return () => {
      active = false
    }
  }, [channelId])

  const currentChannelDetails = channelDetails?.id === channel?.id ? channelDetails : undefined
  const displayedChannel = channel
    ? {
        ...currentChannelDetails,
        ...channel,
        audienceCount: currentChannelDetails?.audienceCount ?? channel.audienceCount,
        category: currentChannelDetails?.category ?? channel.category,
        description: currentChannelDetails?.description ?? channel.description,
        region: currentChannelDetails?.region ?? channel.region,
      }
    : undefined

  return (
    <section
      className="border-input bg-background relative overflow-hidden rounded-[2rem] border shadow-sm"
      aria-label="当前电台信息"
    >
      <RadioBackground />
      <div aria-hidden="true" className="bg-background/5 dark:bg-background/10 pointer-events-none absolute inset-0" />
      <div className="relative p-5 sm:p-7 lg:p-9">
        <div className="grid items-center gap-6 md:grid-cols-[190px_minmax(0,1fr)] md:gap-8 lg:grid-cols-[240px_minmax(260px,0.72fr)_minmax(320px,1fr)] lg:gap-10">
          <div className="bg-card flex aspect-square items-center justify-center overflow-hidden rounded-[1.75rem] shadow-lg">
            {displayedChannel ? (
              <RadioStationCover className="size-full rounded-none" channel={displayedChannel} />
            ) : (
              <Radio className="text-primary size-14" strokeWidth={1.5} />
            )}
          </div>

          <div className="min-w-0 py-1 lg:py-5">
            <h2 className="truncate text-3xl font-semibold tracking-[-0.04em] sm:text-4xl lg:text-5xl">
              {displayedChannel?.title ?? '选择一个声音'}
            </h2>
            <p className="text-primary mt-4 min-h-7 truncate text-lg font-semibold sm:text-xl lg:text-2xl">
              {displayedChannel?.nowPlayingTitle ?? '选中后会立即开始播放'}
            </p>
          </div>

          <RadioStationDetails channel={displayedChannel} />
        </div>
      </div>
    </section>
  )
}

function RadioStationDetails({ channel }: { channel?: RadioChannel }): React.JSX.Element {
  const metadata = [
    { label: '分类', value: channel?.category?.title },
    { label: '地区', value: channel?.region?.title },
    { label: '收听', value: formatAudience(channel?.audienceCount) },
  ].filter((item): item is { label: string; value: string } => Boolean(item.value))

  return (
    <section className="border-border/60 min-w-0 md:col-span-2 lg:col-span-1 lg:border-l lg:py-5 lg:pl-10">
      <h3 className="text-muted-foreground text-xs font-medium tracking-[0.18em]">电台详情</h3>
      {channel ? (
        <>
          {metadata.length ? (
            <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
              {metadata.map((item) => (
                <div key={item.label} className="min-w-20">
                  <dt className="text-muted-foreground text-[11px]">{item.label}</dt>
                  <dd className="text-foreground mt-1 text-sm font-medium">{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <p className="text-muted-foreground mt-5 line-clamp-3 max-w-2xl text-sm leading-6">
            {channel.description || '该电台暂未提供详细介绍。'}
          </p>
        </>
      ) : (
        <p className="text-muted-foreground mt-4 text-sm leading-6">选择电台后，这里会显示分类、地区和简介。</p>
      )}
    </section>
  )
}

export function RadioBottomPlayer(): React.JSX.Element {
  const miniWindowSessionIdRef = useRef<string | undefined>(undefined)
  const [isEnteringMiniWindow, setIsEnteringMiniWindow] = useState(false)
  const channel = useRadioPlayerStore((state) => state.channel)
  const errorMessage = useRadioPlayerStore((state) => state.errorMessage)
  const isMuted = useRadioPlayerStore((state) => state.isMuted)
  const status = useRadioPlayerStore((state) => state.status)
  const volume = useRadioPlayerStore((state) => state.volume)
  const retry = useRadioPlayerStore((state) => state.retry)
  const setMuted = useRadioPlayerStore((state) => state.setMuted)
  const setVolume = useRadioPlayerStore((state) => state.setVolume)
  const toggle = useRadioPlayerStore((state) => state.toggle)

  useEffect(
    () =>
      onMiniWindowModeExit((exit) => {
        if (exit.variant !== 'radio' || miniWindowSessionIdRef.current !== exit.sessionId) return
        miniWindowSessionIdRef.current = undefined
        setIsEnteringMiniWindow(false)
        useRadioPlayerStore.getState().restoreFromMiniWindow(exit)
      }),
    [],
  )

  const isPlaying = status === 'playing'
  return (
    <aside
      aria-label="电台底部播放器"
      className="border-border bg-background absolute inset-x-0 bottom-0 z-40 h-28 overflow-hidden border-t shadow-[0_-8px_30px_rgba(0,0,0,0.08)]"
    >
      <RadioBackground />
      <div aria-hidden="true" className="bg-background/20 dark:bg-background/15 pointer-events-none absolute inset-0" />
      <div className="relative flex h-full w-full items-center gap-4 px-6 sm:gap-5 sm:px-8">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          {channel ? (
            <RadioStationCover className="size-18 shrink-0 rounded-2xl" channel={channel} />
          ) : (
            <span className="bg-primary/10 text-primary flex size-18 shrink-0 items-center justify-center rounded-2xl">
              <Radio size={26} />
            </span>
          )}
          <span className="flex min-w-0 flex-col items-start">
            <span aria-live="polite" className="shrink-0">
              <RadioPlaybackStatusBadge status={status} hasChannel={Boolean(channel)} />
            </span>
            <span className="mt-2 max-w-full min-w-0 truncate text-base leading-6 font-semibold">
              {channel?.title ?? '选择一个电台开始收听'}
            </span>
            <span
              className={cn(
                'text-muted-foreground mt-1 block max-w-full min-w-0 truncate text-sm leading-5',
                errorMessage && 'text-destructive',
              )}
            >
              {errorMessage || channel?.nowPlayingTitle || (channel ? '暂无节目单' : '从列表中选择一个电台')}
            </span>
          </span>
        </div>

        {status === 'error' ? (
          <button
            aria-label="重试播放"
            className="text-primary focus-visible:ring-ring flex size-14 items-center justify-center rounded-full outline-none focus-visible:ring-2"
            type="button"
            onClick={retry}
          >
            <RotateCcw size={24} />
          </button>
        ) : (
          <button
            aria-label={isPlaying || status === 'loading' ? '暂停播放' : '开始播放'}
            className="group/playback focus-visible:ring-ring shrink-0 rounded-full outline-none focus-visible:ring-2"
            disabled={!channel}
            type="button"
            onClick={toggle}
          >
            <RadioPlaybackControlIcon
              size="default"
              state={status === 'loading' ? 'loading' : isPlaying ? 'pause' : 'play'}
            />
          </button>
        )}

        <div className="hidden items-center gap-1 sm:flex">
          <button
            aria-label={isMuted ? '取消静音' : '静音'}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex size-12 items-center justify-center rounded-full outline-none focus-visible:ring-2 disabled:opacity-40"
            disabled={!channel}
            type="button"
            onClick={() => setMuted(!isMuted)}
          >
            {isMuted ? <VolumeX size={22} /> : <Volume2 size={22} />}
          </button>
          <input
            aria-label="音量"
            className="accent-primary hidden w-32 cursor-pointer lg:block"
            disabled={!channel}
            max="1"
            min="0"
            step="0.05"
            type="range"
            value={isMuted ? 0 : volume}
            onChange={(event) => {
              const nextVolume = Number(event.target.value)
              setVolume(nextVolume)
              setMuted(nextVolume === 0)
            }}
          />
        </div>

        {isApiAvailable() ? (
          <button
            aria-label="小窗播放"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex size-12 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!channel || isEnteringMiniWindow}
            title="小窗播放"
            type="button"
            onClick={() => {
              if (!channel || miniWindowSessionIdRef.current) return
              const wasPlaying = ['loading', 'playing'].includes(status)
              const sessionId = crypto.randomUUID()
              miniWindowSessionIdRef.current = sessionId
              setIsEnteringMiniWindow(true)
              useRadioPlayerStore.getState().pause()
              void enterMiniWindowMode({
                sessionId,
                variant: 'radio',
                channel,
                isMuted,
                volume,
              }).catch((error: unknown) => {
                miniWindowSessionIdRef.current = undefined
                setIsEnteringMiniWindow(false)
                if (wasPlaying) useRadioPlayerStore.getState().resume()
                toast.error('进入电台小窗失败', {
                  description: error instanceof Error ? error.message : '请重试。',
                })
              })
            }}
          >
            <PictureInPicture2 size={22} />
          </button>
        ) : null}
      </div>
    </aside>
  )
}

export function RadioPlaybackControlIcon({
  className,
  size = 'compact',
  state,
}: {
  className?: string
  size?: 'compact' | 'default'
  state: 'loading' | 'pause' | 'play' | 'playing'
}): React.JSX.Element {
  const iconSize = size === 'default' ? 24 : 16

  return (
    <span
      aria-hidden="true"
      className={cn(
        'bg-primary text-primary-foreground group-hover/playback:bg-primary/90 flex shrink-0 items-center justify-center rounded-full shadow-sm transition-all group-active/playback:scale-95',
        size === 'default' ? 'size-14' : 'size-10',
        className,
      )}
    >
      {state === 'loading' ? (
        <LoaderCircle className="animate-spin motion-reduce:animate-none" size={iconSize} />
      ) : state === 'pause' ? (
        <Pause size={iconSize} fill="currentColor" />
      ) : state === 'playing' ? (
        <RadioSignal active compact inverted />
      ) : (
        <Play className="ml-0.5" size={iconSize} fill="currentColor" />
      )}
    </span>
  )
}

export function RadioPlaybackStatusBadge({
  hasChannel,
  status,
}: {
  hasChannel: boolean
  status: RadioPlaybackStatus
}): React.JSX.Element {
  const visibleStatus = hasChannel ? status : 'idle'
  const label =
    visibleStatus === 'loading'
      ? '连接中'
      : visibleStatus === 'playing'
        ? '播放中'
        : visibleStatus === 'error'
          ? '播放失败'
          : visibleStatus === 'paused'
            ? '已暂停'
            : '待播放'

  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-2 rounded-full border px-2.5 text-xs leading-none font-medium',
        visibleStatus === 'playing' && 'border-primary/20 bg-primary/10 text-primary',
        visibleStatus === 'loading' && 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300',
        visibleStatus === 'error' && 'border-destructive/20 bg-destructive/10 text-destructive',
        ['idle', 'paused'].includes(visibleStatus) && 'border-border/80 bg-muted/70 text-muted-foreground',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-2 rounded-full bg-current',
          visibleStatus === 'playing' && 'animate-pulse motion-reduce:animate-none',
          visibleStatus === 'loading' && 'animate-pulse motion-reduce:animate-none',
        )}
      />
      {label}
    </span>
  )
}

export function RadioBackground(): React.JSX.Element {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-cover bg-center dark:hidden"
        style={{ backgroundImage: `url(${radioPlayerBackgroundUrl})` }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 hidden bg-cover bg-center dark:block"
        style={{ backgroundImage: `url(${radioPlayerBackgroundDarkUrl})` }}
      />
    </>
  )
}

export function RadioStationCover({
  channel,
  className,
}: {
  channel: RadioChannel
  className: string
}): React.JSX.Element {
  if (channel.coverUrl) {
    return (
      <img
        alt=""
        className={cn('bg-muted object-cover', className)}
        draggable={false}
        src={resolveImageUrl(channel.coverUrl)}
      />
    )
  }
  return (
    <span
      aria-label={channel.title}
      className={cn('bg-primary/10 text-primary flex items-center justify-center', className)}
    >
      <Radio size={22} />
    </span>
  )
}

export function RadioSignal({
  active,
  compact = false,
  inverted = false,
}: {
  active: boolean
  compact?: boolean
  inverted?: boolean
}): React.JSX.Element {
  return (
    <AudioLines
      aria-hidden="true"
      className={cn(
        'text-muted-foreground transition-colors',
        compact ? 'size-4' : 'size-7',
        active && (inverted ? 'text-current' : 'text-primary'),
        active && 'animate-pulse motion-reduce:animate-none',
      )}
    />
  )
}

function teardownPlayback(audio: HTMLAudioElement, hlsRef: React.MutableRefObject<Hls | null>): void {
  audio.pause()
  hlsRef.current?.destroy()
  hlsRef.current = null
  audio.removeAttribute('src')
  audio.load()
}

function createRadioStreamUrl(channelId: number): string {
  return `https://ls.qingting.fm/live/${channelId}/64k.m3u8`
}

function createMediaProxyUrl(proxyBaseUrl: string, sourceUrl: string): string {
  const proxyUrl = new URL('/media', proxyBaseUrl)
  proxyUrl.searchParams.set('url', sourceUrl)
  proxyUrl.searchParams.set('referer', `${new URL(sourceUrl).origin}/`)
  return proxyUrl.toString()
}

function formatAudience(value: number | undefined): string | undefined {
  if (!value) return undefined
  return value >= 10_000 ? `${(value / 10_000).toFixed(1)} 万人` : `${value.toLocaleString()} 人`
}
