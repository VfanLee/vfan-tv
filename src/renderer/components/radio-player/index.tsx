import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import type { ErrorTypes } from 'hls.js'
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
import {
  enterMiniWindowMode,
  getRadioPlaybackUrl,
  getSourceImageUrl,
  getRadioChannelDetail,
  getRadioLivePrograms,
  isApiAvailable,
  onMiniWindowModeExit,
} from '@renderer/platform/api'
import radioPlayerBackgroundUrl from '@renderer/assets/radio-player-background.png'
import radioPlayerBackgroundDarkUrl from '@renderer/assets/radio-player-background-dark.png'
import { useRadioPlayerStore } from '@/stores'
import type { RadioPlaybackCommand, RadioPlaybackStatus } from '@/stores/radio-player'
import { cn, createMediaPlaybackCoordinator } from '@/utils'

const PROGRAM_REFRESH_INTERVAL = 45_000
const MAX_RADIO_HLS_RECOVERY_ATTEMPTS = 3

export function RadioPlaybackEngine(): React.JSX.Element {
  const channel = useRadioPlayerStore((state) => state.channel)
  const command = useRadioPlayerStore((state) => state.command)
  const commandId = useRadioPlayerStore((state) => state.commandId)
  const isMuted = useRadioPlayerStore((state) => state.isMuted)
  const volume = useRadioPlayerStore((state) => state.volume)

  useRadioProgramRefresh(channel?.id, (title) => {
    useRadioPlayerStore.getState().setChannelProgram(title)
  })

  /** 组件卸载时暂停电台播放 */
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

  /** 同步当前频道、控制命令和事件回调引用 */
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

  /** 绑定电台音频事件和媒体播放协调器 */
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const pauseForExternalMedia = (): void => {
      audio.pause()
      reportStatus('paused')
    }
    const playbackCoordinator = createMediaPlaybackCoordinator('radio', pauseForExternalMedia)
    const onPlaying = (): void => {
      if (!['play', 'retry'].includes(commandRef.current)) return
      reportStatus('playing')
      playbackCoordinator.announcePlaying()
    }
    const onWaiting = (): void => {
      if (statusRef.current === 'playing') reportStatus('loading')
    }
    const onPause = (): void => {
      if (statusRef.current === 'playing') reportStatus('paused')
    }
    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('pause', onPause)

    return () => {
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('pause', onPause)
      playbackCoordinator.dispose()
    }
  }, [])

  /** 同步音频音量和静音状态 */
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = volume
    audio.muted = isMuted
  }, [isMuted, volume])

  /** 执行最新的电台播放控制命令 */
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
    const resumeLoadedChannel =
      currentCommand === 'play' && loadedChannelIdRef.current === currentChannel.id && Boolean(audio.currentSrc)
    if (resumeLoadedChannel) {
      void audio.play().catch(() => reportError('无法开始播放，请重试。'))
      return
    }

    teardownPlayback(audio, hlsRef)
    loadedChannelIdRef.current = currentChannel.id
    reportStatus('loading')
    let active = true
    let recoveryAttempts = 0
    const recoverPlayback = (hls: Hls, errorType: ErrorTypes): boolean => {
      recoveryAttempts += 1
      if (recoveryAttempts > MAX_RADIO_HLS_RECOVERY_ATTEMPTS) return false
      if (errorType === Hls.ErrorTypes.NETWORK_ERROR) {
        hls.startLoad()
        return true
      }
      if (errorType === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError()
        return true
      }
      return false
    }
    const onAudioError = (): void => {
      if (!hlsRef.current) reportError('播放失败，请重试。')
    }
    audio.addEventListener('error', onAudioError)
    void getRadioPlaybackUrl(currentChannel.id)
      .then((playbackUrl) => {
        if (!active) return
        if (Hls.isSupported()) {
          const hls = new Hls(createRadioHlsConfig())
          hlsRef.current = hls
          const isCurrentHls = (): boolean => active && hlsRef.current === hls
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (!isCurrentHls() || !['play', 'retry'].includes(commandRef.current)) return
            void audio.play().catch(() => reportError('无法开始播放，请重试。'))
          })
          hls.on(Hls.Events.LEVEL_LOADED, () => {
            if (!isCurrentHls()) return
            recoveryAttempts = 0
          })
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!isCurrentHls()) return
            if (!data.fatal || recoverPlayback(hls, data.type)) return
            reportError('播放失败，请重试。')
          })
          hls.loadSource(playbackUrl)
          hls.attachMedia(audio)
        } else {
          audio.src = playbackUrl
          void audio.play().catch(() => reportError('无法开始播放，请重试。'))
        }
      })
      .catch(() => {
        if (active) reportError('本地音频代理未就绪，请重试。')
      })
    return () => {
      active = false
      audio.removeEventListener('error', onAudioError)
    }
  }, [commandId])

  /** 组件卸载时销毁电台音频播放实例 */
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

  /** 同步节目更新回调引用 */
  useEffect(() => {
    onProgramRef.current = onProgram
  }, [onProgram])

  /** 加载当前直播节目并定时刷新 */
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

  /** 加载当前电台频道详情 */
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
        <div className="grid items-center gap-6 md:grid-cols-[190px_minmax(0,1fr)] md:gap-8 lg:grid-cols-[240px_minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
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
            <p className="text-muted-foreground mt-4 min-h-7 truncate text-lg font-semibold sm:text-xl lg:text-2xl">
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

  /** 监听电台迷你窗口退出事件并恢复播放状态 */
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
            <button
              aria-label={
                status === 'error'
                  ? '播放失败，请使用重试按钮'
                  : isPlaying || status === 'loading'
                    ? '暂停播放'
                    : '开始播放'
              }
              className="group/cover focus-visible:ring-ring relative size-20 shrink-0 cursor-pointer overflow-hidden rounded-2xl p-0 shadow-md ring-1 ring-black/5 transition-transform outline-none focus-visible:ring-2 active:scale-[0.97] disabled:cursor-default disabled:active:scale-100 motion-reduce:transition-none"
              disabled={status === 'error'}
              type="button"
              onClick={toggle}
            >
              <RadioStationCover className="size-full rounded-none" channel={channel} />
              <span
                aria-hidden="true"
                className={cn(
                  'absolute inset-0 flex items-center justify-center bg-black/25 text-white transition-colors motion-reduce:transition-none',
                  status === 'error' ? 'bg-black/35' : 'group-hover/cover:bg-black/40',
                )}
              >
                {status === 'error' ? (
                  <AudioLines className="text-white/70 drop-shadow-lg" size={30} strokeWidth={2.25} />
                ) : status === 'loading' ? (
                  <LoaderCircle className="animate-spin drop-shadow-lg motion-reduce:animate-none" size={28} />
                ) : isPlaying ? (
                  <AudioLines
                    className="animate-pulse drop-shadow-lg motion-reduce:animate-none"
                    size={30}
                    strokeWidth={2.25}
                  />
                ) : (
                  <Play className="ml-0.5 drop-shadow-lg" size={28} fill="currentColor" />
                )}
              </span>
            </button>
          ) : (
            <span className="bg-primary/10 text-primary flex size-20 shrink-0 items-center justify-center rounded-2xl">
              <Radio size={26} />
            </span>
          )}
          <span className="flex min-w-0 flex-col items-start">
            <span aria-live="polite" className="sr-only">
              {status === 'playing'
                ? '正在播放'
                : status === 'loading'
                  ? '正在连接'
                  : status === 'error'
                    ? '播放失败'
                    : status === 'paused'
                      ? '播放已暂停'
                      : '等待播放'}
            </span>
            <span className="max-w-full min-w-0 truncate text-base leading-6 font-semibold">
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
        ) : null}

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
  const [resolvedCover, setResolvedCover] = useState<{ key: string; url?: string }>()
  const coverUrl = resolvedCover && resolvedCover.key === channel.coverUrl ? resolvedCover.url : undefined
  /** 解析并更新电台封面地址 */
  useEffect(() => {
    let active = true
    if (channel.coverUrl) {
      void getSourceImageUrl(undefined, channel.coverUrl, undefined, 'radio').then((url) => {
        if (active) setResolvedCover({ key: channel.coverUrl ?? '', url })
      })
    }
    return () => {
      active = false
    }
  }, [channel.coverUrl])
  if (coverUrl) {
    return <img alt="" className={cn('bg-muted object-cover', className)} draggable={false} src={coverUrl} />
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

/** 创建适用于直播电台的 HLS 加载与重试配置 */
function createRadioHlsConfig(): ConstructorParameters<typeof Hls>[0] {
  return {
    enableWorker: true,
    lowLatencyMode: false,
    manifestLoadingMaxRetry: 6,
    manifestLoadingRetryDelay: 1_000,
    manifestLoadingMaxRetryTimeout: 64_000,
    levelLoadingMaxRetry: 4,
    levelLoadingRetryDelay: 1_000,
    fragLoadingMaxRetry: 6,
    fragLoadingRetryDelay: 1_000,
    fragLoadingMaxRetryTimeout: 64_000,
    liveSyncDurationCount: 4,
    liveMaxLatencyDurationCount: 10,
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    backBufferLength: 30,
  }
}

function formatAudience(value: number | undefined): string | undefined {
  if (!value) return undefined
  return value >= 10_000 ? `${(value / 10_000).toFixed(1)} 万人` : `${value.toLocaleString()} 人`
}
