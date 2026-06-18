import {
  Copy,
  Check,
  FastForward,
  Info,
  Loader2,
  Maximize,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  Rewind,
  SkipBack,
  SkipForward,
  TriangleAlert,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/Button'

const SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5] as const
const SEEK_PRESETS = [5, 10, 15, 30] as const
const DEFAULT_SEEK_STEP_SECONDS = 5
const SEEK_STEP_STORAGE_KEY = 'vfan-player-seek-step'
const LONG_PRESS_MS = 400
const LONG_VOLUME_INTERVAL_MS = 80
const ACTION_HINT_HIDE_MS = 700
const CONTROLS_HIDE_MS = 2000
const MAX_ERROR_LOGS = 100

type ActionHint =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek-back'; seconds: number }
  | { type: 'seek-forward'; seconds: number }
  | { type: 'volume'; percent: number }

interface BasicPlayerProps {
  autoPlay?: boolean
  className?: string
  src?: string
  title?: string
  initialTime?: number
  hasNextEpisode?: boolean
  hasPreviousEpisode?: boolean
  isTheaterMode?: boolean
  onNextEpisode?: () => void
  onEnded?: () => void
  onPreviousEpisode?: () => void
  onProgress?: (progress: { currentTime: number; duration: number }) => void
  onToggleTheaterMode?: () => void
}

interface PlayerErrorLog {
  id: number
  timestamp: number
  source: 'HLS' | 'HTMLMediaElement'
  message: string
  fatal: boolean
}

interface KeyHoldState {
  key: string
  timer: ReturnType<typeof setTimeout> | null
  interval: ReturnType<typeof setInterval> | null
  isLongPress: boolean
  actionTaken: boolean
}

interface BufferedSegment {
  startPercent: number
  widthPercent: number
}

export function BasicPlayer({
  autoPlay = false,
  className,
  hasNextEpisode = false,
  hasPreviousEpisode = false,
  initialTime = 0,
  isTheaterMode = false,
  onNextEpisode,
  onEnded,
  onPreviousEpisode,
  onProgress,
  onToggleTheaterMode,
  src,
  title,
}: BasicPlayerProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const didApplyInitialTimeRef = useRef(false)
  const keyHoldRef = useRef<KeyHoldState | null>(null)
  const playbackRateRef = useRef(1)
  const seekStepRef = useRef(DEFAULT_SEEK_STEP_SECONDS)
  const actionHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const controlsHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryTimeRef = useRef(0)
  const errorLogIdRef = useRef(0)
  const isSeekingRef = useRef(false)
  const [errorLogs, setErrorLogs] = useState<PlayerErrorLog[]>([])
  const [isErrorLogOpen, setIsErrorLogOpen] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [customSpeed, setCustomSpeed] = useState('2')
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false)
  const [seekMenuOpen, setSeekMenuOpen] = useState(false)
  const [seekStepSeconds, setSeekStepSeconds] = useState(() => readStoredSeekStep())
  const [customSeekStep, setCustomSeekStep] = useState('5')
  const [showControls, setShowControls] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [volumeMenuOpen, setVolumeMenuOpen] = useState(false)
  const [actionHint, setActionHint] = useState<ActionHint | null>(null)
  const [speedHint, setSpeedHint] = useState<number | null>(null)
  const [isSeeking, setIsSeeking] = useState(false)
  const [seekPreviewTime, setSeekPreviewTime] = useState(0)
  const [bufferedRanges, setBufferedRanges] = useState<BufferedSegment[]>([])
  const [isSourceInfoOpen, setIsSourceInfoOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  isSeekingRef.current = isSeeking
  playbackRateRef.current = playbackRate
  seekStepRef.current = seekStepSeconds

  const revealControls = useCallback((): void => {
    setShowControls(true)

    if (controlsHideTimerRef.current) {
      clearTimeout(controlsHideTimerRef.current)
    }

    controlsHideTimerRef.current = setTimeout(() => {
      setShowControls(false)
      setSpeedMenuOpen(false)
      setSeekMenuOpen(false)
      setVolumeMenuOpen(false)
    }, CONTROLS_HIDE_MS)
  }, [])

  const hideControls = useCallback((): void => {
    if (controlsHideTimerRef.current) {
      clearTimeout(controlsHideTimerRef.current)
      controlsHideTimerRef.current = null
    }

    setShowControls(false)
    setSpeedMenuOpen(false)
    setSeekMenuOpen(false)
    setVolumeMenuOpen(false)
  }, [])

  const appendErrorLog = useCallback((source: PlayerErrorLog['source'], message: string, fatal: boolean): void => {
    errorLogIdRef.current += 1
    const nextLog: PlayerErrorLog = {
      id: errorLogIdRef.current,
      timestamp: Date.now(),
      source,
      message,
      fatal,
    }

    setErrorLogs((current) => [...current.slice(-(MAX_ERROR_LOGS - 1)), nextLog])
  }, [])

  const retryPlayback = (): void => {
    retryTimeRef.current = videoRef.current?.currentTime ?? 0
    setIsLoading(Boolean(src))
    setReloadNonce((current) => current + 1)
  }

  const showActionHint = useCallback((hint: ActionHint): void => {
    setActionHint(hint)

    if (actionHintTimerRef.current) {
      clearTimeout(actionHintTimerRef.current)
    }

    actionHintTimerRef.current = setTimeout(() => {
      setActionHint(null)
    }, ACTION_HINT_HIDE_MS)
  }, [])

  const applyVolume = useCallback(
    (nextVolume: number, direction?: 'up' | 'down'): void => {
      const video = videoRef.current
      if (!video) {
        return
      }

      let clamped = Math.min(1, Math.max(0, nextVolume))

      if (direction) {
        const currentStep = Math.round((video.muted ? 0 : video.volume) * 10)
        const nextStep = Math.min(10, Math.max(0, currentStep + (direction === 'up' ? 1 : -1)))
        clamped = nextStep / 10
      }

      video.volume = clamped
      video.muted = clamped === 0
      setVolume(clamped)
      setIsMuted(clamped === 0)

      if (direction) {
        showActionHint({ type: 'volume', percent: Math.round(clamped * 100) })
      }
    },
    [showActionHint],
  )

  const applyPlaybackRate = useCallback((rate: number): void => {
    const video = videoRef.current
    if (!video) {
      return
    }

    const clamped = Math.min(4, Math.max(0.25, rate))
    video.playbackRate = clamped
    setPlaybackRate(clamped)
  }, [])

  const togglePlay = useCallback(
    (showHint = false): void => {
      const video = videoRef.current
      if (!video) {
        return
      }

      if (video.paused) {
        void video.play()
        if (showHint) {
          showActionHint({ type: 'play' })
        }
        return
      }

      video.pause()
      if (showHint) {
        showActionHint({ type: 'pause' })
      }
    },
    [showActionHint],
  )

  const seekTo = useCallback((time: number): void => {
    const video = videoRef.current
    if (!video || !Number.isFinite(video.duration)) {
      return
    }

    video.currentTime = Math.min(video.duration, Math.max(0, time))
    setCurrentTime(video.currentTime)
  }, [])

  const updateBufferedRanges = useCallback((): void => {
    const video = videoRef.current
    if (!video) {
      return
    }

    setBufferedRanges(getBufferedSegments(video))
  }, [])

  const seekBy = useCallback(
    (deltaSeconds: number, showHint = false): void => {
      const video = videoRef.current
      if (!video || !Number.isFinite(video.duration)) {
        return
      }

      video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + deltaSeconds))

      if (showHint) {
        if (deltaSeconds < 0) {
          showActionHint({ type: 'seek-back', seconds: Math.abs(deltaSeconds) })
        } else if (deltaSeconds > 0) {
          showActionHint({ type: 'seek-forward', seconds: deltaSeconds })
        }
      }
    },
    [showActionHint],
  )

  const toggleFullscreen = useCallback(async (): Promise<void> => {
    const container = containerRef.current
    if (!container) {
      return
    }

    if (document.fullscreenElement) {
      await document.exitFullscreen()
      return
    }

    await container.requestFullscreen()
  }, [])

  const applySeekStep = useCallback((seconds: number): void => {
    const clamped = Math.min(300, Math.max(1, Math.round(seconds)))
    setSeekStepSeconds(clamped)
    seekStepRef.current = clamped
    window.localStorage.setItem(SEEK_STEP_STORAGE_KEY, String(clamped))
  }, [])

  const clearKeyHold = useCallback((): void => {
    const hold = keyHoldRef.current
    if (!hold) {
      return
    }

    if (hold.timer) {
      clearTimeout(hold.timer)
    }

    if (hold.interval) {
      clearInterval(hold.interval)
    }

    keyHoldRef.current = null
  }, [])

  const restoreBoostedSpeed = useCallback((): void => {
    const video = videoRef.current
    if (!video) {
      return
    }

    video.playbackRate = playbackRateRef.current
    setSpeedHint(null)
  }, [])

  const startSpeedBoost = useCallback((): void => {
    const video = videoRef.current
    if (!video) {
      return
    }

    const boosted = Math.min(4, playbackRateRef.current * 2)
    video.playbackRate = boosted
    setSpeedHint(boosted)
  }, [])

  const startVolumeRepeat = useCallback(
    (direction: 1 | -1): void => {
      const hold = keyHoldRef.current
      if (!hold) {
        return
      }

      hold.interval = setInterval(() => {
        const video = videoRef.current
        if (!video) {
          return
        }

        applyVolume(video.volume, direction === 1 ? 'up' : 'down')
      }, LONG_VOLUME_INTERVAL_MS)
    },
    [applyVolume],
  )

  const handleArrowKeyDown = useCallback(
    (key: string): void => {
      if (keyHoldRef.current?.key === key) {
        return
      }

      clearKeyHold()

      const hold: KeyHoldState = {
        key,
        timer: null,
        interval: null,
        isLongPress: false,
        actionTaken: false,
      }
      keyHoldRef.current = hold

      hold.timer = setTimeout(() => {
        if (keyHoldRef.current !== hold) {
          return
        }

        hold.isLongPress = true

        if (key === 'ArrowUp') {
          startVolumeRepeat(1)
          return
        }

        if (key === 'ArrowDown') {
          startVolumeRepeat(-1)
          return
        }

        if (key === 'ArrowLeft' || key === 'ArrowRight') {
          startSpeedBoost()
        }
      }, LONG_PRESS_MS)
    },
    [clearKeyHold, startSpeedBoost, startVolumeRepeat],
  )

  const handleArrowKeyUp = useCallback(
    (key: string): void => {
      const hold = keyHoldRef.current
      if (!hold || hold.key !== key) {
        return
      }

      if (hold.timer) {
        clearTimeout(hold.timer)
      }

      if (hold.interval) {
        clearInterval(hold.interval)
      }

      if (hold.isLongPress) {
        if (key === 'ArrowLeft' || key === 'ArrowRight') {
          restoreBoostedSpeed()
        }
      } else if (!hold.actionTaken) {
        if (key === 'ArrowUp') {
          applyVolume(videoRef.current?.volume ?? volume, 'up')
        } else if (key === 'ArrowDown') {
          applyVolume(videoRef.current?.volume ?? volume, 'down')
        } else if (key === 'ArrowLeft') {
          seekBy(-seekStepRef.current, true)
        } else if (key === 'ArrowRight') {
          seekBy(seekStepRef.current, true)
        }
      }

      keyHoldRef.current = null
    },
    [applyVolume, restoreBoostedSpeed, seekBy, volume],
  )

  useEffect(() => {
    didApplyInitialTimeRef.current = false
    setCurrentTime(0)
    setDuration(0)
    setIsPlaying(false)
    setSpeedMenuOpen(false)
    setSeekMenuOpen(false)
    setVolumeMenuOpen(false)
    setActionHint(null)
    setSpeedHint(null)
    setIsSeeking(false)
    setBufferedRanges([])
    setIsSourceInfoOpen(false)
    setIsErrorLogOpen(false)
    setErrorLogs([])
    errorLogIdRef.current = 0
    retryTimeRef.current = 0
    setIsLoading(Boolean(src))
  }, [src])

  useEffect(() => {
    const video = videoRef.current

    if (!video || !src) {
      return
    }

    if (src.includes('.m3u8') && Hls.isSupported()) {
      const hls = new Hls()
      hls.on(Hls.Events.ERROR, (_event, data) => {
        const message = `${data.type}: ${data.details}${data.error?.message ? ` - ${data.error.message}` : ''}`
        appendErrorLog('HLS', message, data.fatal)

        if (data.fatal) {
          setIsLoading(false)
        }
      })
      hls.loadSource(src)
      hls.attachMedia(video)
      return () => hls.destroy()
    }

    video.src = src
    return () => {
      video.removeAttribute('src')
      video.load()
    }
  }, [appendErrorLog, reloadNonce, src])

  useEffect(() => {
    applyPlaybackRate(playbackRate)
  }, [applyPlaybackRate, playbackRate, src])

  useEffect(() => {
    const onFullscreenChange = (): void => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }

    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  useEffect(() => {
    if (speedHint === null) {
      return
    }

    const timer = setTimeout(() => {
      if (!keyHoldRef.current) {
        setSpeedHint(null)
      }
    }, 1200)
    return () => clearTimeout(timer)
  }, [speedHint])

  useEffect(() => {
    if (!speedMenuOpen && !seekMenuOpen) {
      return
    }

    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Node) || containerRef.current?.contains(target)) {
        return
      }

      setSpeedMenuOpen(false)
      setSeekMenuOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [seekMenuOpen, speedMenuOpen])

  useEffect(() => {
    if (!volumeMenuOpen) {
      return
    }

    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Node) || containerRef.current?.contains(target)) {
        return
      }

      setVolumeMenuOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [volumeMenuOpen])

  useEffect(() => {
    if (!isSourceInfoOpen && !isErrorLogOpen) {
      return
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsSourceInfoOpen(false)
        setIsErrorLogOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isErrorLogOpen, isSourceInfoOpen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target)) {
        return
      }

      if (event.key === ' ') {
        event.preventDefault()
        togglePlay(true)
        revealControls()
        return
      }

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        if (event.repeat) {
          return
        }

        handleArrowKeyDown(event.key)
        revealControls()
      }
    }

    const onKeyUp = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target)) {
        return
      }

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        handleArrowKeyUp(event.key)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      clearKeyHold()
    }
  }, [clearKeyHold, handleArrowKeyDown, handleArrowKeyUp, revealControls, togglePlay])

  useEffect(() => {
    return () => {
      if (actionHintTimerRef.current) {
        clearTimeout(actionHintTimerRef.current)
      }
      if (controlsHideTimerRef.current) {
        clearTimeout(controlsHideTimerRef.current)
      }
    }
  }, [])

  const commitSeek = useCallback(
    (time: number): void => {
      seekTo(time)
      setIsSeeking(false)
    },
    [seekTo],
  )

  const handleSurfaceClick = (): void => {
    containerRef.current?.focus()
    togglePlay(true)
    revealControls()
  }

  const progressTime = isSeeking ? seekPreviewTime : currentTime
  const progressPercent = duration > 0 ? (progressTime / duration) * 100 : 0

  const selectSpeed = (rate: number): void => {
    applyPlaybackRate(rate)
    setSpeedMenuOpen(false)
  }

  const applyCustomSpeed = (): void => {
    const parsed = Number(customSpeed)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return
    }

    applyPlaybackRate(parsed)
    setSpeedMenuOpen(false)
  }

  const selectSeekStep = (seconds: number): void => {
    applySeekStep(seconds)
    setSeekMenuOpen(false)
  }

  const applyCustomSeekStep = (): void => {
    const parsed = Number(customSeekStep)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return
    }

    applySeekStep(parsed)
    setSeekMenuOpen(false)
  }

  const speedLabel = SPEED_PRESETS.includes(playbackRate as (typeof SPEED_PRESETS)[number])
    ? `${playbackRate}x`
    : `${playbackRate.toFixed(2).replace(/\.?0+$/, '')}x`

  const seekStepLabel = `${seekStepSeconds}s`

  return (
    <div
      ref={containerRef}
      className={cn(
        'group/player relative h-full w-full bg-black outline-none',
        !showControls && !isErrorLogOpen && !isSourceInfoOpen && 'cursor-none',
        className,
      )}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === ' ') {
          event.preventDefault()
        }
      }}
      onMouseEnter={revealControls}
      onMouseMove={revealControls}
      onMouseLeave={hideControls}
    >
      <video
        ref={videoRef}
        className="pointer-events-none absolute inset-0 h-full w-full bg-black object-contain"
        autoPlay={autoPlay}
        playsInline
        preload="metadata"
        onLoadStart={() => setIsLoading(true)}
        onWaiting={() => setIsLoading(true)}
        onCanPlay={() => setIsLoading(false)}
        onPlaying={() => setIsLoading(false)}
        onSeeking={() => setIsLoading(true)}
        onSeeked={() => {
          const video = videoRef.current
          if (!video) {
            return
          }

          if (video.paused || video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
            setIsLoading(false)
          }
        }}
        onLoadedMetadata={() => {
          const video = videoRef.current

          if (!video) {
            return
          }

          if (!didApplyInitialTimeRef.current && initialTime > 0 && initialTime < video.duration) {
            video.currentTime = initialTime
            didApplyInitialTimeRef.current = true
          } else if (retryTimeRef.current > 0 && retryTimeRef.current < video.duration) {
            video.currentTime = retryTimeRef.current
          }
          retryTimeRef.current = 0

          video.volume = volume
          video.playbackRate = playbackRate
          setDuration(Number.isFinite(video.duration) ? video.duration : 0)
          setCurrentTime(video.currentTime)
          setIsPlaying(!video.paused)
          updateBufferedRanges()

          onProgress?.({
            currentTime: Math.floor(video.currentTime),
            duration: Number.isFinite(video.duration) ? Math.floor(video.duration) : 0,
          })

          void attemptAutoPlay(video, autoPlay)
        }}
        onPlay={() => {
          setIsPlaying(true)
          revealControls()
        }}
        onPause={() => {
          setIsPlaying(false)
        }}
        onEnded={() => {
          setIsPlaying(false)
          onEnded?.()
        }}
        onProgress={updateBufferedRanges}
        onTimeUpdate={() => {
          const video = videoRef.current

          if (!video || isSeekingRef.current) {
            return
          }

          setCurrentTime(video.currentTime)

          onProgress?.({
            currentTime: Math.floor(video.currentTime),
            duration: Number.isFinite(video.duration) ? Math.floor(video.duration) : 0,
          })
        }}
        onVolumeChange={() => {
          const video = videoRef.current
          if (!video) {
            return
          }

          setVolume(video.muted ? 0 : video.volume)
          setIsMuted(video.muted || video.volume === 0)
        }}
        onError={() => {
          setIsLoading(false)
          const video = videoRef.current
          const code = video?.error?.code
          appendErrorLog('HTMLMediaElement', code ? `媒体加载失败，错误代码 ${code}` : '播放器加载失败', true)
        }}
      />

      {isLoading && src ? (
        <div className="pointer-events-none absolute inset-0 z-[15] flex items-center justify-center bg-black/30">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="text-primary animate-spin" size={36} />
            <span className="text-sm font-medium text-white/85">加载中</span>
          </div>
        </div>
      ) : null}

      {src ? (
        <button
          aria-label={isPlaying ? '暂停' : '播放'}
          className={cn('absolute inset-0 z-10', showControls ? 'cursor-default' : 'cursor-none')}
          type="button"
          onClick={handleSurfaceClick}
        />
      ) : null}

      {src ? (
        <div
          className={cn(
            'absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 px-4 pt-4 transition-opacity duration-150',
            showControls ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        >
          {title ? (
            <div className="pointer-events-none min-w-0 flex-1 rounded-lg bg-black/75 px-3.5 py-2.5 text-base font-semibold text-white shadow-lg shadow-black/25 backdrop-blur-sm">
              <span className="block truncate">{title}</span>
            </div>
          ) : (
            <div className="min-w-0 flex-1" />
          )}
          <div className="flex shrink-0 items-center gap-2">
            <PlayerTopButton label="刷新重试" onClick={retryPlayback}>
              <RefreshCw size={18} />
            </PlayerTopButton>
            <PlayerTopButton
              label={`查看错误日志${errorLogs.length > 0 ? `（${errorLogs.length}）` : ''}`}
              tone={errorLogs.length > 0 ? 'warning' : 'default'}
              onClick={() => setIsErrorLogOpen(true)}
            >
              <TriangleAlert size={18} />
            </PlayerTopButton>
            <PlayerTopButton label="查看播放地址" onClick={() => setIsSourceInfoOpen(true)}>
              <Info size={18} />
            </PlayerTopButton>
          </div>
        </div>
      ) : null}

      {isSourceInfoOpen && src ? <PlaySourceInfoModal src={src} onClose={() => setIsSourceInfoOpen(false)} /> : null}

      {isErrorLogOpen ? <PlayerErrorLogModal logs={errorLogs} onClose={() => setIsErrorLogOpen(false)} /> : null}

      <ActionFeedbackOverlay hint={actionHint} />

      {speedHint !== null ? (
        <div className="pointer-events-none absolute top-1/2 left-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 items-center rounded-lg bg-black/70 px-4 py-3 text-sm font-semibold text-white">
          倍速 {speedHint.toFixed(2).replace(/\.?0+$/, '')}x
        </div>
      ) : null}

      {!src ? (
        <div className="text-muted-foreground absolute inset-0 flex items-center justify-center bg-black text-sm">
          请选择一个可播放剧集
        </div>
      ) : null}

      {src ? (
        <div
          className={cn(
            'absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-4 pt-10 pb-3 transition-opacity duration-150',
            showControls ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
          data-player-control=""
        >
          <div
            className="group/progress relative mb-3 h-1 w-full transition-[height] duration-150 hover:h-2"
            data-player-control=""
          >
            <div className="absolute inset-0 rounded-full bg-white/20" />
            {bufferedRanges.map((segment, index) => (
              <div
                key={`${segment.startPercent}-${segment.widthPercent}-${index}`}
                className="absolute inset-y-0 rounded-full bg-white/35"
                style={{
                  left: `${segment.startPercent}%`,
                  width: `${segment.widthPercent}%`,
                }}
              />
            ))}
            <div
              className="absolute inset-y-0 left-0 z-1 rounded-full bg-primary transition-[width] duration-75"
              style={{ width: `${progressPercent}%` }}
            />
            <div
              className="absolute top-1/2 z-3 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary shadow-sm transition-transform duration-150 group-hover/progress:scale-125"
              style={{ left: `${progressPercent}%` }}
            />
            <input
              aria-label="播放进度"
              className="absolute inset-0 z-2 h-full w-full cursor-pointer opacity-0"
              max={duration || 0}
              min={0}
              step={0.1}
              type="range"
              value={progressTime}
              onChange={(event) => setSeekPreviewTime(Number(event.target.value))}
              onPointerDown={() => {
                setIsSeeking(true)
                setSeekPreviewTime(progressTime)
              }}
              onPointerUp={(event) => commitSeek(Number(event.currentTarget.value))}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1.5" data-player-control="">
              <PlayerIconButton
                aria-label="上一集"
                disabled={!hasPreviousEpisode}
                onClick={() => onPreviousEpisode?.()}
              >
                <SkipBack size={18} />
              </PlayerIconButton>
              <PlayerIconButton aria-label={isPlaying ? '暂停' : '播放'} onClick={() => togglePlay(true)}>
                {isPlaying ? <Pause size={20} /> : <Play size={20} />}
              </PlayerIconButton>
              <PlayerIconButton aria-label="下一集" disabled={!hasNextEpisode} onClick={() => onNextEpisode?.()}>
                <SkipForward size={18} />
              </PlayerIconButton>
              <span className="ml-2 text-xs font-medium whitespace-nowrap text-white/90 tabular-nums">
                {formatTime(progressTime)} / {formatTime(duration)}
              </span>
            </div>

            <div className="flex items-center gap-1.5" data-player-control="">
              <div className="relative">
                <button
                  className="inline-flex h-8 items-center rounded-md px-2.5 text-xs font-semibold text-white/90 transition-colors hover:bg-white/15"
                  type="button"
                  onClick={() => {
                    setSeekMenuOpen((open) => !open)
                    setSpeedMenuOpen(false)
                  }}
                >
                  步长 {seekStepLabel}
                </button>
                {seekMenuOpen ? (
                  <div className="absolute right-0 bottom-full z-30 mb-2 min-w-36 rounded-lg border border-white/10 bg-black/90 p-1.5 shadow-xl backdrop-blur">
                    {SEEK_PRESETS.map((seconds) => (
                      <button
                        key={seconds}
                        className={cn(
                          'flex w-full items-center rounded-md px-3 py-2 text-left text-xs font-semibold text-white/90 transition-colors hover:bg-white/10',
                          seekStepSeconds === seconds && 'bg-white/15 text-white',
                        )}
                        type="button"
                        onClick={() => selectSeekStep(seconds)}
                      >
                        {seconds} 秒
                      </button>
                    ))}
                    <div className="mt-1 border-t border-white/10 pt-1">
                      <div className="px-2 py-1 text-[11px] font-medium text-white/60">自定义</div>
                      <div className="flex items-center gap-1 px-1">
                        <input
                          className="h-8 w-16 rounded-md border border-white/15 bg-white/10 px-2 text-xs text-white outline-none focus:border-white/35"
                          inputMode="numeric"
                          min={1}
                          step={1}
                          type="number"
                          value={customSeekStep}
                          onChange={(event) => setCustomSeekStep(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              applyCustomSeekStep()
                            }
                          }}
                        />
                        <button
                          className="inline-flex h-8 items-center rounded-md px-2 text-xs font-semibold text-white/90 transition-colors hover:bg-white/10"
                          type="button"
                          onClick={applyCustomSeekStep}
                        >
                          应用
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="relative">
                <button
                  className="inline-flex h-8 items-center rounded-md px-2.5 text-xs font-semibold text-white/90 transition-colors hover:bg-white/15"
                  type="button"
                  onClick={() => {
                    setSpeedMenuOpen((open) => !open)
                    setSeekMenuOpen(false)
                  }}
                >
                  倍速 {speedLabel}
                </button>
                {speedMenuOpen ? (
                  <div className="absolute right-0 bottom-full z-20 mb-2 min-w-36 rounded-lg border border-white/10 bg-black/90 p-1.5 shadow-xl backdrop-blur">
                    {SPEED_PRESETS.map((rate) => (
                      <button
                        key={rate}
                        className={cn(
                          'flex w-full items-center rounded-md px-3 py-2 text-left text-xs font-semibold text-white/90 transition-colors hover:bg-white/10',
                          playbackRate === rate && 'bg-white/15 text-white',
                        )}
                        type="button"
                        onClick={() => selectSpeed(rate)}
                      >
                        {rate}x
                      </button>
                    ))}
                    <div className="mt-1 border-t border-white/10 pt-1">
                      <div className="px-2 py-1 text-[11px] font-medium text-white/60">自定义</div>
                      <div className="flex items-center gap-1 px-1">
                        <input
                          className="h-8 w-16 rounded-md border border-white/15 bg-white/10 px-2 text-xs text-white outline-none focus:border-white/35"
                          inputMode="decimal"
                          step="0.05"
                          type="number"
                          value={customSpeed}
                          onChange={(event) => setCustomSpeed(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              applyCustomSpeed()
                            }
                          }}
                        />
                        <button
                          className="inline-flex h-8 items-center rounded-md px-2 text-xs font-semibold text-white/90 transition-colors hover:bg-white/10"
                          type="button"
                          onClick={applyCustomSpeed}
                        >
                          应用
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="relative">
                <PlayerIconButton
                  aria-expanded={volumeMenuOpen}
                  aria-label={isMuted || volume === 0 ? '取消静音' : '音量'}
                  onClick={() => {
                    setVolumeMenuOpen((open) => !open)
                    setSpeedMenuOpen(false)
                    setSeekMenuOpen(false)
                  }}
                >
                  {isMuted || volume === 0 ? <VolumeX size={18} /> : volume < 0.5 ? <Volume1 size={18} /> : <Volume2 size={18} />}
                </PlayerIconButton>
                {volumeMenuOpen ? (
                  <div className="absolute right-0 bottom-full z-30 mb-2 flex flex-col items-center rounded-lg border border-white/10 bg-black/90 px-3 py-3 shadow-xl backdrop-blur">
                    <span className="mb-2 text-[11px] font-semibold text-white/70 tabular-nums">
                      {Math.round((isMuted ? 0 : volume) * 100)}%
                    </span>
                    <div className="flex h-28 w-8 items-center justify-center">
                      <input
                        aria-label="音量"
                        className="h-1.5 w-28 -rotate-90 cursor-pointer accent-white"
                        max={1}
                        min={0}
                        step={0.01}
                        type="range"
                        value={isMuted ? 0 : volume}
                        onChange={(event) => applyVolume(Number(event.target.value))}
                      />
                    </div>
                    <button
                      className="mt-2 text-[11px] font-semibold text-white/70 transition-colors hover:text-white"
                      type="button"
                      onClick={() => {
                        const video = videoRef.current
                        if (!video) {
                          return
                        }

                        if (video.muted || video.volume === 0) {
                          applyVolume(volume > 0 ? volume : 0.5)
                          return
                        }

                        applyVolume(0)
                      }}
                    >
                      {isMuted || volume === 0 ? '取消静音' : '静音'}
                    </button>
                  </div>
                ) : null}
              </div>

              <PlayerIconButton
                aria-label={isTheaterMode ? '退出宽屏' : '宽屏播放'}
                onClick={() => onToggleTheaterMode?.()}
              >
                {isTheaterMode ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              </PlayerIconButton>
              <PlayerIconButton
                aria-label={isFullscreen ? '退出全屏' : '全屏'}
                onClick={() => void toggleFullscreen()}
              >
                <Maximize size={18} />
              </PlayerIconButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function PlayerTopButton({
  children,
  label,
  onClick,
  tone = 'default',
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  tone?: 'default' | 'warning'
}): React.JSX.Element {
  return (
    <button
      aria-label={label}
      className={cn(
        'inline-flex size-10 items-center justify-center rounded-lg bg-black/75 text-white shadow-lg shadow-black/25 backdrop-blur-sm transition-colors hover:bg-black/90',
        tone === 'warning' && 'text-destructive',
      )}
      title={label}
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      {children}
    </button>
  )
}

function PlayerErrorLogModal({ logs, onClose }: { logs: PlayerErrorLog[]; onClose: () => void }): React.JSX.Element {
  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/45 px-4" onClick={onClose}>
      <div
        aria-labelledby="player-error-log-title"
        className="border-border bg-card flex max-h-[70vh] w-full max-w-2xl flex-col rounded-lg border p-4 shadow-lg"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-foreground text-sm font-semibold" id="player-error-log-title">
              当前播放错误日志
            </h2>
            <p className="text-muted-foreground mt-1 text-xs">切换剧集或播放地址后自动清空。</p>
          </div>
          <button
            aria-label="关闭错误日志"
            className="text-muted-foreground hover:text-foreground inline-flex size-7 items-center justify-center rounded-md transition-colors"
            type="button"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>

        {logs.length > 0 ? (
          <div className="border-border mt-4 min-h-0 flex-1 overflow-y-auto rounded-md border">
            {[...logs].reverse().map((log) => (
              <div key={log.id} className="border-border border-b px-3 py-3 last:border-b-0">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                  <span className={log.fatal ? 'text-destructive' : 'text-muted-foreground'}>
                    {log.fatal ? '严重' : '可恢复'}
                  </span>
                  <span className="text-foreground">{log.source}</span>
                  <time className="text-muted-foreground ml-auto">{formatLogTime(log.timestamp)}</time>
                </div>
                <p className="text-muted-foreground mt-2 font-mono text-xs leading-5 break-words">{log.message}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="border-input text-muted-foreground mt-4 flex h-36 items-center justify-center rounded-md border border-dashed text-sm">
            当前播放尚未产生错误日志
          </div>
        )}
      </div>
    </div>
  )
}

function PlaySourceInfoModal({ onClose, src }: { onClose: () => void; src: string }): React.JSX.Element {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const copyUrl = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(src)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 2000)
    } catch {
      setCopyState('failed')
      window.setTimeout(() => setCopyState('idle'), 2000)
    }
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center px-4" onClick={onClose}>
      <div
        className="border-border bg-card w-full max-w-xl rounded-lg border p-4 shadow-lg"
        role="dialog"
        aria-labelledby="play-source-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-foreground text-sm font-semibold" id="play-source-title">
            播放地址
          </h2>
          <button
            aria-label="关闭"
            className="text-muted-foreground hover:text-foreground inline-flex size-7 items-center justify-center rounded-md transition-colors"
            type="button"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>

        <p className="bg-muted text-foreground mt-3 rounded-md border border-border px-3 py-2 font-mono text-xs leading-5 break-all">
          {src}
        </p>

        <div className="mt-3 flex justify-end">
          <Button className="h-8 px-3 text-xs" type="button" variant="primary" onClick={() => void copyUrl()}>
            {copyState === 'copied' ? <Check size={14} /> : <Copy size={14} />}
            {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function formatLogTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp)
}

function getBufferedSegments(video: HTMLVideoElement): BufferedSegment[] {
  const { buffered, duration } = video

  if (!Number.isFinite(duration) || duration <= 0) {
    return []
  }

  const segments: BufferedSegment[] = []

  for (let index = 0; index < buffered.length; index += 1) {
    const start = buffered.start(index)
    const end = buffered.end(index)

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue
    }

    segments.push({
      startPercent: (start / duration) * 100,
      widthPercent: ((end - start) / duration) * 100,
    })
  }

  return segments
}

function ActionFeedbackOverlay({ hint }: { hint: ActionHint | null }): React.JSX.Element | null {
  if (!hint) {
    return null
  }

  if (hint.type === 'play' || hint.type === 'pause') {
    return (
      <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
        <div className="flex size-20 items-center justify-center rounded-full bg-black/55 text-white shadow-lg shadow-black/30 backdrop-blur-sm">
          {hint.type === 'play' ? <Play fill="currentColor" size={40} /> : <Pause fill="currentColor" size={40} />}
        </div>
      </div>
    )
  }

  if (hint.type === 'seek-back') {
    return (
      <div className="pointer-events-none absolute inset-y-0 left-0 z-30 flex items-center pl-10">
        <div className="flex flex-col items-center gap-2 rounded-2xl bg-black/55 px-6 py-4 text-white shadow-lg shadow-black/30 backdrop-blur-sm">
          <Rewind size={32} />
          <span className="text-base font-semibold tabular-nums">-{hint.seconds}s</span>
        </div>
      </div>
    )
  }

  if (hint.type === 'seek-forward') {
    return (
      <div className="pointer-events-none absolute inset-y-0 right-0 z-30 flex items-center pr-10">
        <div className="flex flex-col items-center gap-2 rounded-2xl bg-black/55 px-6 py-4 text-white shadow-lg shadow-black/30 backdrop-blur-sm">
          <FastForward size={32} />
          <span className="text-base font-semibold tabular-nums">+{hint.seconds}s</span>
        </div>
      </div>
    )
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
      <div className="flex items-center gap-3 rounded-2xl bg-black/55 px-6 py-4 text-white shadow-lg shadow-black/30 backdrop-blur-sm">
        {hint.percent === 0 ? (
          <VolumeX size={30} />
        ) : hint.percent < 50 ? (
          <Volume1 size={30} />
        ) : (
          <Volume2 size={30} />
        )}
        <span className="text-xl font-semibold tabular-nums">{hint.percent}%</span>
      </div>
    </div>
  )
}

function readStoredSeekStep(): number {
  const raw = window.localStorage.getItem(SEEK_STEP_STORAGE_KEY)
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SEEK_STEP_SECONDS
  }

  return Math.min(300, Math.max(1, Math.round(parsed)))
}

function PlayerIconButton({
  children,
  className,
  disabled,
  onClick,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  return (
    <button
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-md text-white/90 transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-35',
        className,
      )}
      disabled={disabled}
      type="button"
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  )
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '00:00'
  }

  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`
  }

  return `${pad(minutes)}:${pad(secs)}`
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  const tagName = target.tagName
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || target.isContentEditable
}

async function attemptAutoPlay(video: HTMLVideoElement, autoPlay: boolean): Promise<void> {
  if (!autoPlay || !video.paused) {
    return
  }

  try {
    await video.play()
  } catch {
    // Some environments still block autoplay; custom controls remain available.
  }
}
