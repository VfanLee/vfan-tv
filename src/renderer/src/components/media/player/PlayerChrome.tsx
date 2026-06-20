import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  Controls,
  FullscreenButton,
  MediaAnnouncer,
  PlayButton,
  TimeSlider,
  VolumeSlider,
  useMediaState,
  type MediaPlayerInstance,
} from '@vidstack/react'
import {
  ChevronLeft,
  ChevronRight,
  FastForward,
  Gauge,
  Info,
  Loader2,
  Minus,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Rewind,
  Settings,
  ShieldCheck,
  SkipBack,
  SkipForward,
  TimerReset,
  TriangleAlert,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { PlayerErrorLogDialog, PlaySourceDialog } from './PlayerDialogs'
import type { ActionHint, KeyHoldState, PlayerErrorLog } from './types'

const SPEED_PRESETS = [1, 1.25, 1.5, 2, 3] as const
const SEEK_PRESETS = [5, 10, 15, 30] as const
const MIN_PLAYBACK_RATE = 0.1
const MAX_PLAYBACK_RATE = 10
const DEFAULT_SEEK_STEP_SECONDS = 5
const SEEK_STEP_STORAGE_KEY = 'vfan-player-seek-step'
const LONG_PRESS_MS = 400
const LONG_VOLUME_INTERVAL_MS = 80
const ACTION_HINT_HIDE_MS = 700
const CONTROLS_IDLE_HIDE_MS = 5000

type SettingsPage = 'root' | 'seek' | 'speed'

interface PlayerChromeProps {
  errorLogs: PlayerErrorLog[]
  hasNextEpisode: boolean
  hasPreviousEpisode: boolean
  isTheaterMode: boolean
  playlistFilteringEnabled: boolean
  playerRef: RefObject<MediaPlayerInstance | null>
  src: string
  title?: string
  onNextEpisode?: () => void
  onPlaybackRateChange?: (playbackRate: number) => void
  onPreviousEpisode?: () => void
  onRetry: () => void
  onToggleTheaterMode?: () => void
  onTogglePlaylistFiltering: () => void
}

export function PlayerChrome({
  errorLogs,
  hasNextEpisode,
  hasPreviousEpisode,
  isTheaterMode,
  playlistFilteringEnabled,
  playerRef,
  src,
  title,
  onNextEpisode,
  onPlaybackRateChange,
  onPreviousEpisode,
  onRetry,
  onToggleTheaterMode,
  onTogglePlaylistFiltering,
}: PlayerChromeProps): React.JSX.Element {
  const paused = useMediaState('paused')
  const currentTime = useMediaState('currentTime')
  const duration = useMediaState('duration')
  const volume = useMediaState('volume')
  const muted = useMediaState('muted')
  const playbackRate = useMediaState('playbackRate')
  const fullscreen = useMediaState('fullscreen')
  const waiting = useMediaState('waiting')
  const keyHoldRef = useRef<KeyHoldState | null>(null)
  const actionHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const controlsHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const controlActionsRef = useRef<HTMLDivElement>(null)
  const lastAudibleVolumeRef = useRef(1)
  const pointerInsidePlayerRef = useRef(false)
  const settingsOpenRef = useRef(false)
  const waitingRef = useRef(waiting)
  const [actionHint, setActionHint] = useState<ActionHint | null>(null)
  const [controlsLayerVisible, setControlsLayerVisible] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsPage, setSettingsPage] = useState<SettingsPage>('root')
  const [volumeExpanded, setVolumeExpanded] = useState(false)
  const [isSourceOpen, setIsSourceOpen] = useState(false)
  const [isErrorLogOpen, setIsErrorLogOpen] = useState(false)
  const [seekStepSeconds, setSeekStepSeconds] = useState(() => readStoredSeekStep())

  const controlsAreVisible = controlsLayerVisible || settingsOpen || volumeExpanded

  useEffect(() => {
    waitingRef.current = waiting
  }, [waiting])

  useEffect(() => {
    settingsOpenRef.current = settingsOpen
  }, [settingsOpen])

  useEffect(() => {
    if (!muted && volume > 0) {
      lastAudibleVolumeRef.current = volume
    }
  }, [muted, volume])

  const clearControlsHideTimer = useCallback((): void => {
    if (controlsHideTimerRef.current) {
      clearTimeout(controlsHideTimerRef.current)
      controlsHideTimerRef.current = null
    }
  }, [])

  const hideControlsLayer = useCallback((): void => {
    clearControlsHideTimer()
    setControlsLayerVisible(false)
    setSettingsOpen(false)
    setSettingsPage('root')
    setVolumeExpanded(false)
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  }, [clearControlsHideTimer])

  const scheduleControlsHide = useCallback(
    (force = false): void => {
      clearControlsHideTimer()
      if (!force && settingsOpenRef.current) {
        return
      }

      controlsHideTimerRef.current = setTimeout(() => {
        if (settingsOpenRef.current) {
          return
        }

        setControlsLayerVisible(false)
        setVolumeExpanded(false)
      }, CONTROLS_IDLE_HIDE_MS)
    },
    [clearControlsHideTimer],
  )

  const revealControlsLayer = useCallback((): void => {
    pointerInsidePlayerRef.current = true
    setControlsLayerVisible(true)
    scheduleControlsHide()
  }, [scheduleControlsHide])

  const dismissOverlayPanels = useCallback((): void => {
    setSettingsOpen(false)
    setSettingsPage('root')
    setVolumeExpanded(false)
  }, [])

  const resetControlPointerState = useCallback((): void => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }

    const container = controlActionsRef.current
    if (!container) {
      return
    }

    container.style.pointerEvents = 'none'
    requestAnimationFrame(() => {
      if (controlActionsRef.current) {
        controlActionsRef.current.style.pointerEvents = ''
      }
    })
  }, [])

  const handleTheaterModeClick = useCallback((): void => {
    dismissOverlayPanels()
    onToggleTheaterMode?.()
    resetControlPointerState()
    if (pointerInsidePlayerRef.current) {
      setControlsLayerVisible(true)
      scheduleControlsHide(true)
      return
    }

    hideControlsLayer()
  }, [dismissOverlayPanels, hideControlsLayer, onToggleTheaterMode, resetControlPointerState, scheduleControlsHide])

  const handleFullscreenClick = useCallback((): void => {
    dismissOverlayPanels()
    resetControlPointerState()
    if (pointerInsidePlayerRef.current) {
      setControlsLayerVisible(true)
      scheduleControlsHide(true)
      return
    }

    hideControlsLayer()
  }, [dismissOverlayPanels, hideControlsLayer, resetControlPointerState, scheduleControlsHide])

  const showActionHint = useCallback((hint: ActionHint): void => {
    setActionHint(hint)
    if (actionHintTimerRef.current) {
      clearTimeout(actionHintTimerRef.current)
    }
    actionHintTimerRef.current = setTimeout(() => setActionHint(null), ACTION_HINT_HIDE_MS)
  }, [])

  const applyVolume = useCallback(
    (nextVolume: number, direction?: 'up' | 'down'): void => {
      const player = playerRef.current
      if (!player) {
        return
      }

      let clamped = Math.min(1, Math.max(0, nextVolume))
      if (direction) {
        const currentStep = Math.round((player.muted ? 0 : player.volume) * 10)
        clamped = Math.min(10, Math.max(0, currentStep + (direction === 'up' ? 1 : -1))) / 10
      }

      player.volume = clamped
      player.muted = clamped === 0
      if (direction) {
        showActionHint({ type: 'volume', percent: Math.round(clamped * 100) })
      }
    },
    [playerRef, showActionHint],
  )

  const applyPlaybackRate = useCallback(
    (rate: number): void => {
      const clamped = Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, rate))
      if (playerRef.current) {
        playerRef.current.playbackRate = clamped
      }
      onPlaybackRateChange?.(clamped)
    },
    [onPlaybackRateChange, playerRef],
  )

  const toggleMuted = useCallback((): void => {
    const player = playerRef.current
    if (!player) {
      return
    }

    if (player.muted || player.volume === 0) {
      const restoredVolume = Math.min(1, Math.max(0.1, lastAudibleVolumeRef.current))
      player.volume = restoredVolume
      player.muted = false
      showActionHint({ type: 'volume', percent: Math.round(restoredVolume * 100) })
      return
    }

    lastAudibleVolumeRef.current = player.volume
    player.muted = true
    showActionHint({ type: 'volume', percent: 0 })
  }, [playerRef, showActionHint])

  const togglePlay = useCallback(
    (withHint = false): void => {
      const player = playerRef.current
      if (!player) {
        return
      }

      if (player.paused) {
        void player.play()
        if (withHint) showActionHint({ type: 'play' })
      } else {
        void player.pause()
        if (withHint) showActionHint({ type: 'pause' })
      }
    },
    [playerRef, showActionHint],
  )

  const seekBy = useCallback(
    (seconds: number, withHint = false): void => {
      const player = playerRef.current
      if (!player || !Number.isFinite(player.duration)) {
        return
      }

      player.currentTime = Math.min(player.duration, Math.max(0, player.currentTime + seconds))
      if (withHint && seconds !== 0) {
        showActionHint(
          seconds < 0 ? { type: 'seek-back', seconds: Math.abs(seconds) } : { type: 'seek-forward', seconds },
        )
      }
    },
    [playerRef, showActionHint],
  )

  const clearKeyHold = useCallback((): void => {
    const hold = keyHoldRef.current
    if (hold?.timer) clearTimeout(hold.timer)
    if (hold?.interval) clearInterval(hold.interval)
    keyHoldRef.current = null
  }, [])

  const handleArrowKeyDown = useCallback(
    (key: string): void => {
      if (keyHoldRef.current?.key === key) {
        return
      }
      clearKeyHold()

      const hold: KeyHoldState = { key, timer: null, interval: null, isLongPress: false }
      keyHoldRef.current = hold
      hold.timer = setTimeout(() => {
        if (keyHoldRef.current !== hold) return
        hold.isLongPress = true
        if (waitingRef.current) return

        if (key !== 'ArrowUp' && key !== 'ArrowDown') {
          return
        }

        const direction = key === 'ArrowUp' ? 'up' : 'down'
        hold.interval = setInterval(() => {
          applyVolume(playerRef.current?.volume ?? 0, direction)
        }, LONG_VOLUME_INTERVAL_MS)
      }, LONG_PRESS_MS)
    },
    [applyVolume, clearKeyHold, playerRef],
  )

  const handleArrowKeyUp = useCallback(
    (key: string): void => {
      const hold = keyHoldRef.current
      if (!hold || hold.key !== key) return
      if (hold.timer) clearTimeout(hold.timer)
      if (hold.interval) clearInterval(hold.interval)

      if (!hold.isLongPress && key === 'ArrowUp') {
        applyVolume(playerRef.current?.volume ?? volume, 'up')
      } else if (!hold.isLongPress && key === 'ArrowDown') {
        applyVolume(playerRef.current?.volume ?? volume, 'down')
      }

      keyHoldRef.current = null
    },
    [applyVolume, playerRef, volume],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target)) return
      if (event.key === ' ') {
        event.preventDefault()
        togglePlay(true)
        return
      }
      if (isArrowKey(event.key)) {
        event.preventDefault()
        if (event.repeat) return
        if (event.key === 'ArrowLeft') {
          seekBy(-seekStepSeconds, true)
        } else if (event.key === 'ArrowRight') {
          seekBy(seekStepSeconds, true)
        } else {
          handleArrowKeyDown(event.key)
        }
      }
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (!isEditableTarget(event.target) && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        handleArrowKeyUp(event.key)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [handleArrowKeyDown, handleArrowKeyUp, seekBy, seekStepSeconds, togglePlay])

  useEffect(() => {
    return () => clearKeyHold()
  }, [clearKeyHold])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsSourceOpen(false)
        setIsErrorLogOpen(false)
        if (settingsPage !== 'root') {
          setSettingsPage('root')
        } else {
          setSettingsOpen(false)
        }
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [settingsPage])

  useEffect(() => {
    if (!settingsOpen) {
      return
    }

    const closeSettingsOnOutsidePointerDown = (event: PointerEvent): void => {
      if (
        event.target instanceof Element &&
        event.target.closest('[data-player-settings-panel], [data-player-settings-trigger]')
      ) {
        return
      }

      setSettingsOpen(false)
      setSettingsPage('root')
      if (pointerInsidePlayerRef.current) {
        setControlsLayerVisible(true)
        scheduleControlsHide(true)
      } else {
        hideControlsLayer()
      }
    }

    document.addEventListener('pointerdown', closeSettingsOnOutsidePointerDown, true)
    return () => document.removeEventListener('pointerdown', closeSettingsOnOutsidePointerDown, true)
  }, [hideControlsLayer, scheduleControlsHide, settingsOpen])

  useEffect(() => {
    return () => {
      if (actionHintTimerRef.current) clearTimeout(actionHintTimerRef.current)
      clearControlsHideTimer()
    }
  }, [clearControlsHideTimer])

  const applySeekStep = (seconds: number): void => {
    const clamped = Math.min(300, Math.max(1, Math.round(seconds)))
    setSeekStepSeconds(clamped)
    window.localStorage.setItem(SEEK_STEP_STORAGE_KEY, String(clamped))
  }

  return (
    <div
      className={cn('absolute inset-0 z-10', controlsAreVisible ? 'cursor-default' : 'cursor-none')}
      onPointerEnter={revealControlsLayer}
      onPointerLeave={() => {
        pointerInsidePlayerRef.current = false
        hideControlsLayer()
      }}
      onPointerMove={revealControlsLayer}
    >
      <MediaAnnouncer />

      <button
        aria-label={paused ? '播放' : '暂停'}
        className="absolute inset-0 z-10"
        type="button"
        onClick={() => {
          setSettingsOpen(false)
          setSettingsPage('root')
          setVolumeExpanded(false)
          scheduleControlsHide(true)
          togglePlay(true)
        }}
      />

      {waiting ? (
        <div className="pointer-events-none absolute inset-0 z-15 flex items-center justify-center bg-black/30">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="text-primary animate-spin" size={36} />
            <span className="text-sm font-medium text-white/85">加载中</span>
          </div>
        </div>
      ) : null}

      <Controls.Root className="pointer-events-none absolute inset-0 z-20">
        <Controls.Group
          className={cn(
            'absolute inset-x-0 top-0 flex items-start justify-between gap-3 px-4 pt-4 transition-opacity duration-150',
            controlsAreVisible ? 'pointer-events-auto opacity-100' : 'opacity-0',
          )}
        >
          {title ? (
            <div className="pointer-events-none min-w-0 flex-1 px-1 py-2 text-[17px] leading-6 font-semibold text-white">
              <span className="block truncate">{title}</span>
            </div>
          ) : (
            <div className="min-w-0 flex-1" />
          )}
          <div className="flex shrink-0 items-center gap-2">
            <PlayerTopButton label="刷新重试" onClick={onRetry}>
              <RefreshCw size={18} />
            </PlayerTopButton>
            <PlayerTopButton
              label={`查看错误日志${errorLogs.length > 0 ? `（${errorLogs.length}）` : ''}`}
              tone={errorLogs.length > 0 ? 'warning' : 'default'}
              onClick={() => setIsErrorLogOpen(true)}
            >
              <TriangleAlert size={18} />
            </PlayerTopButton>
            <PlayerTopButton label="查看播放地址" onClick={() => setIsSourceOpen(true)}>
              <Info size={18} />
            </PlayerTopButton>
          </div>
        </Controls.Group>

        <Controls.Group
          className={cn(
            'absolute inset-x-0 bottom-0 bg-linear-to-t from-black/82 via-black/45 to-transparent px-3.5 pt-14 pb-2.5 transition-opacity duration-150',
            controlsAreVisible ? 'pointer-events-auto opacity-100' : 'opacity-0',
          )}
        >
          <PlayerTimeSlider />

          <div className="mt-1.5 flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-1">
              <PlayerControlTooltip label="上一集">
                <PlayerIconButton
                  aria-label="上一集"
                  disabled={!hasPreviousEpisode}
                  onClick={() => onPreviousEpisode?.()}
                >
                  <SkipBack fill="currentColor" size={20} />
                </PlayerIconButton>
              </PlayerControlTooltip>

              <PlayButton
                aria-label={paused ? '播放' : '暂停'}
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/14 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
              >
                {paused ? (
                  <Play className="ml-0.5" fill="currentColor" size={21} />
                ) : (
                  <Pause fill="currentColor" size={21} />
                )}
              </PlayButton>

              <PlayerControlTooltip label="下一集">
                <PlayerIconButton aria-label="下一集" disabled={!hasNextEpisode} onClick={() => onNextEpisode?.()}>
                  <SkipForward fill="currentColor" size={20} />
                </PlayerIconButton>
              </PlayerControlTooltip>

              <PlayerVolumeControl
                expanded={volumeExpanded}
                muted={muted}
                volume={volume}
                onToggleMute={toggleMuted}
                onVolumePreview={(percent) => showActionHint({ type: 'volume', percent })}
                onExpandedChange={(expanded) => {
                  setVolumeExpanded(expanded)
                  if (expanded) {
                    setSettingsOpen(false)
                    setSettingsPage('root')
                  }
                }}
              />

              <div className="px-2.5 py-2 text-[13px] leading-none font-medium whitespace-nowrap text-white/88 tabular-nums">
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>
            </div>

            <div ref={controlActionsRef} className="relative flex shrink-0 items-center gap-2">
              <PlayerControlTooltip label="设置">
                <PlayerIconButton
                  aria-expanded={settingsOpen}
                  aria-label="设置"
                  data-player-settings-trigger="true"
                  onClick={() => {
                    const nextSettingsOpen = !settingsOpen
                    setSettingsOpen(nextSettingsOpen)
                    setSettingsPage('root')
                    setVolumeExpanded(false)
                    setControlsLayerVisible(true)
                    if (nextSettingsOpen) {
                      clearControlsHideTimer()
                    } else {
                      scheduleControlsHide(true)
                    }
                  }}
                >
                  <Settings size={19} />
                </PlayerIconButton>
              </PlayerControlTooltip>
              <PlayerControlTooltip label="影院模式">
                <PlayerIconButton aria-label="影院模式" onClick={handleTheaterModeClick}>
                  <TheaterModeIcon active={isTheaterMode} />
                </PlayerIconButton>
              </PlayerControlTooltip>
              <PlayerControlTooltip label="全屏">
                <FullscreenButton aria-label="全屏" className={playerButtonClass} onClick={handleFullscreenClick}>
                  <FullscreenModeIcon active={fullscreen} />
                </FullscreenButton>
              </PlayerControlTooltip>

              {settingsOpen ? (
                <PlayerSettingsPanel
                  page={settingsPage}
                  playbackRate={playbackRate}
                  playlistFilteringEnabled={playlistFilteringEnabled}
                  seekStepSeconds={seekStepSeconds}
                  onApplyPlaybackRate={applyPlaybackRate}
                  onApplySeekStep={applySeekStep}
                  onPageChange={setSettingsPage}
                  onTogglePlaylistFiltering={onTogglePlaylistFiltering}
                />
              ) : null}
            </div>
          </div>
        </Controls.Group>
      </Controls.Root>

      <ActionFeedbackOverlay hint={actionHint} />

      {isSourceOpen ? <PlaySourceDialog src={src} onClose={() => setIsSourceOpen(false)} /> : null}
      {isErrorLogOpen ? <PlayerErrorLogDialog logs={errorLogs} onClose={() => setIsErrorLogOpen(false)} /> : null}
    </div>
  )
}

function PlayerTimeSlider(): React.JSX.Element {
  return (
    <TimeSlider.Root
      aria-label="播放进度"
      className="group/time relative flex h-4 w-full cursor-pointer touch-none items-center outline-none"
    >
      <TimeSlider.Track className="relative h-1 w-full overflow-hidden rounded-full bg-white/28 transition-[height] duration-100 group-hover/time:h-1.5 group-data-dragging/time:h-1.5">
        <TimeSlider.Progress className="absolute inset-y-0 left-0 w-(--slider-progress) rounded-full bg-white/45" />
        <TimeSlider.TrackFill className="bg-primary absolute inset-y-0 left-0 w-(--slider-fill) rounded-full" />
      </TimeSlider.Track>
      <TimeSlider.Thumb className="bg-primary absolute left-(--slider-fill) size-3 -translate-x-1/2 rounded-full opacity-0 shadow-sm transition-[opacity,transform] duration-100 group-hover/time:scale-125 group-hover/time:opacity-100 group-data-dragging/time:scale-125 group-data-dragging/time:opacity-100" />
    </TimeSlider.Root>
  )
}

function PlayerVolumeControl({
  expanded,
  muted,
  volume,
  onToggleMute,
  onVolumePreview,
  onExpandedChange,
}: {
  expanded: boolean
  muted: boolean
  volume: number
  onToggleMute: () => void
  onVolumePreview: (percent: number) => void
  onExpandedChange: (expanded: boolean) => void
}): React.JSX.Element {
  const previewPointerVolume = (event: React.PointerEvent<HTMLElement>): void => {
    onVolumePreview(getPointerVolumePercent(event.currentTarget, event.clientX))
  }

  return (
    <div
      className={cn(
        'flex h-10 shrink-0 items-center overflow-hidden rounded-full transition-[width,background-color] duration-150',
        expanded ? 'w-34 bg-white/10' : 'w-10 bg-transparent',
      )}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          onExpandedChange(false)
        }
      }}
      onFocus={() => onExpandedChange(true)}
      onMouseEnter={() => onExpandedChange(true)}
      onMouseLeave={() => onExpandedChange(false)}
    >
      <button
        aria-expanded={expanded}
        aria-label={muted || volume === 0 ? '取消静音' : '静音'}
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/14 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
        type="button"
        onClick={onToggleMute}
      >
        <VolumeIcon muted={muted} volume={volume} />
      </button>
      <VolumeSlider.Root
        aria-label="音量"
        className={cn(
          'group/volume relative mr-3 ml-1 flex h-8 cursor-pointer touch-none items-center transition-[width,opacity] duration-150 outline-none',
          expanded ? 'w-20 opacity-100' : 'w-0 opacity-0',
        )}
        onPointerDown={previewPointerVolume}
        onPointerMove={(event) => {
          if (event.buttons === 1) {
            previewPointerVolume(event)
          }
        }}
        onPointerUp={previewPointerVolume}
      >
        <VolumeSlider.Track className="relative h-1 w-full overflow-hidden rounded-full bg-white/35">
          <VolumeSlider.TrackFill className="absolute inset-y-0 left-0 w-(--slider-fill) rounded-full bg-white" />
        </VolumeSlider.Track>
        <VolumeSlider.Thumb className="absolute left-(--slider-fill) size-3 -translate-x-1/2 rounded-full bg-white shadow-md ring-1 ring-black/20" />
      </VolumeSlider.Root>
    </div>
  )
}

function PlayerSettingsPanel({
  page,
  playbackRate,
  playlistFilteringEnabled,
  seekStepSeconds,
  onApplyPlaybackRate,
  onApplySeekStep,
  onPageChange,
  onTogglePlaylistFiltering,
}: {
  page: SettingsPage
  playbackRate: number
  playlistFilteringEnabled: boolean
  seekStepSeconds: number
  onApplyPlaybackRate: (rate: number) => void
  onApplySeekStep: (seconds: number) => void
  onPageChange: (page: SettingsPage) => void
  onTogglePlaylistFiltering: () => void
}): React.JSX.Element {
  if (page === 'speed') {
    return (
      <SettingsDetailPanel
        label="播放倍速"
        max={MAX_PLAYBACK_RATE}
        min={MIN_PLAYBACK_RATE}
        presets={SPEED_PRESETS}
        step={0.05}
        unit="x"
        value={playbackRate}
        onBack={() => onPageChange('root')}
        onChange={onApplyPlaybackRate}
      />
    )
  }

  if (page === 'seek') {
    return (
      <SettingsDetailPanel
        label="快进步长"
        max={60}
        min={1}
        presets={SEEK_PRESETS}
        step={1}
        unit="秒"
        value={seekStepSeconds}
        onBack={() => onPageChange('root')}
        onChange={onApplySeekStep}
      />
    )
  }

  return (
    <div
      aria-label="播放设置"
      className="absolute right-0 bottom-full z-30 mb-5 w-80 overflow-hidden rounded-xl border border-white/10 bg-black/86 p-2.5 text-white shadow-2xl shadow-black/45 backdrop-blur-2xl"
      data-player-settings-panel="true"
      role="dialog"
    >
      <SettingsRow
        icon={<TimerReset size={24} />}
        label="快进步长"
        value={`${seekStepSeconds} 秒`}
        onClick={() => onPageChange('seek')}
      />
      <SettingsRow
        icon={<Gauge size={24} />}
        label="播放倍速"
        value={formatRate(playbackRate)}
        onClick={() => onPageChange('speed')}
      />
      <SettingsToggleRow
        enabled={playlistFilteringEnabled}
        icon={<ShieldCheck size={24} />}
        label="去广告（实验性）"
        onToggle={onTogglePlaylistFiltering}
      />
    </div>
  )
}

function SettingsToggleRow({
  enabled,
  icon,
  label,
  onToggle,
}: {
  enabled: boolean
  icon: React.ReactNode
  label: string
  onToggle: () => void
}): React.JSX.Element {
  return (
    <button
      aria-pressed={enabled}
      className="flex w-full items-center rounded-xl px-1 py-1.5 text-left transition-colors hover:bg-white/9 focus:outline-none"
      type="button"
      onClick={(event) => {
        onToggle()
        event.currentTarget.blur()
      }}
    >
      <span className="flex size-10 items-center justify-center text-white/86">{icon}</span>
      <span className="min-w-0 flex-1 text-base leading-6 font-medium text-white/92">{label}</span>
      <span className="mr-2 text-sm whitespace-nowrap text-white/64">{enabled ? '已开启' : '已关闭'}</span>
      <span
        aria-hidden="true"
        className={cn('relative h-5 w-9 rounded-full bg-white/24 transition-colors', enabled && 'bg-primary')}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform',
            enabled && 'translate-x-4',
          )}
        />
      </span>
    </button>
  )
}

function SettingsDetailPanel({
  label,
  max,
  min,
  presets,
  step,
  unit,
  value,
  onBack,
  onChange,
}: {
  label: string
  max: number
  min: number
  presets: readonly number[]
  step: number
  unit: 'x' | '秒'
  value: number
  onBack: () => void
  onChange: (value: number) => void
}): React.JSX.Element {
  const displayValue = unit === 'x' ? formatRate(value) : `${Math.round(value)} 秒`

  return (
    <div
      aria-label={label}
      className="absolute right-0 bottom-full z-30 mb-3 w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-white/10 bg-black/86 text-white shadow-2xl shadow-black/45 backdrop-blur-2xl"
      data-player-settings-panel="true"
      role="dialog"
    >
      <button
        className="flex w-full items-center gap-3 border-b border-white/10 px-4 py-4 text-left text-base font-semibold text-white/95 transition-colors hover:bg-white/8 focus:outline-none"
        type="button"
        onClick={(event) => {
          onBack()
          event.currentTarget.blur()
        }}
      >
        <ChevronLeft size={24} />
        {label}
      </button>

      <div className="flex flex-col gap-6 px-6 py-6">
        <div className="text-center text-2xl font-semibold tracking-tight text-white tabular-nums">{displayValue}</div>
        <div className="flex items-center gap-3">
          <SettingsAdjustButton
            label={`降低${label}`}
            onClick={() => onChange(Math.max(min, Number((value - step).toFixed(2))))}
          >
            <Minus size={20} />
          </SettingsAdjustButton>
          <input
            aria-label={label}
            className="accent-primary h-1 min-w-0 flex-1 cursor-pointer"
            max={max}
            min={min}
            step={step}
            type="range"
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
          />
          <SettingsAdjustButton
            label={`提高${label}`}
            onClick={() => onChange(Math.min(max, Number((value + step).toFixed(2))))}
          >
            <Plus size={20} />
          </SettingsAdjustButton>
        </div>
        <div className={cn('grid gap-2', presets.length === 5 ? 'grid-cols-5' : 'grid-cols-4')}>
          {presets.map((preset) =>
            unit === 'x' ? (
              <div key={preset} className="flex flex-col items-center gap-1">
                <button
                  className={cn(
                    'flex min-h-12 w-full flex-col items-center justify-center rounded-xl bg-white/9 px-2 py-2 text-sm leading-tight font-semibold text-white/86 transition-colors hover:bg-white/16 hover:text-white focus:outline-none',
                    value === preset && 'bg-white text-black hover:bg-white hover:text-black',
                  )}
                  type="button"
                  onClick={(event) => {
                    onChange(preset)
                    event.currentTarget.blur()
                  }}
                >
                  {preset === 1 ? '1.0' : preset}
                </button>
                {preset === 1 ? <span className="text-[11px] font-medium text-white/70">正常</span> : null}
              </div>
            ) : (
              <button
                key={preset}
                className={cn(
                  'flex min-h-12 flex-col items-center justify-center rounded-full bg-white/9 px-2 py-2 text-sm leading-tight font-semibold text-white/86 transition-colors hover:bg-white/16 hover:text-white focus:outline-none',
                  value === preset && 'bg-white text-black hover:bg-white hover:text-black',
                )}
                type="button"
                onClick={(event) => {
                  onChange(preset)
                  event.currentTarget.blur()
                }}
              >
                {`${preset}s`}
              </button>
            ),
          )}
        </div>
      </div>
    </div>
  )
}

function SettingsRow({
  icon,
  label,
  value,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  value: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      className="flex w-full items-center rounded-xl px-1 py-1.5 text-left transition-colors hover:bg-white/9 focus:outline-none"
      type="button"
      onClick={(event) => {
        onClick()
        event.currentTarget.blur()
      }}
    >
      <span className="flex size-10 items-center justify-center text-white/86">{icon}</span>
      <span className="min-w-0 flex-1 text-base leading-6 font-medium text-white/92">{label}</span>
      <span className="text-sm whitespace-nowrap text-white/64 tabular-nums">{value}</span>
      <ChevronRight className="text-white/48" size={20} />
    </button>
  )
}

function SettingsAdjustButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      aria-label={label}
      className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/90 transition-colors hover:bg-white/18 focus:outline-none"
      type="button"
      onClick={(event) => {
        onClick()
        event.currentTarget.blur()
      }}
    >
      {children}
    </button>
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
        'inline-flex size-10 items-center justify-center rounded-full text-white/92 transition-colors hover:bg-white/14 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none',
        tone === 'warning' && 'text-destructive',
      )}
      title={label}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

const playerButtonClass =
  'inline-flex size-10 items-center justify-center rounded-full text-white/92 transition-colors hover:bg-white/14 focus:outline-none disabled:cursor-not-allowed disabled:opacity-35'

function PlayerIconButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  return (
    <button className={cn(playerButtonClass, className)} type="button" {...props}>
      {children}
    </button>
  )
}

function PlayerControlTooltip({ children, label }: { children: React.ReactNode; label: string }): React.JSX.Element {
  return (
    <div className="group/tooltip relative">
      {children}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-5 -translate-x-1/2 rounded-xl bg-[#3f3f3f] px-2 py-1.5 text-base leading-none font-medium whitespace-nowrap text-white opacity-0 shadow-md transition-opacity duration-150 group-hover/tooltip:opacity-100"
      >
        {label}
      </span>
    </div>
  )
}

function VolumeIcon({ muted, volume }: { muted: boolean; volume: number }): React.JSX.Element {
  if (muted || volume === 0) return <VolumeX size={21} />
  if (volume < 0.5) return <Volume1 size={21} />
  return <Volume2 size={21} />
}

function TheaterModeIcon({ active }: { active: boolean }): React.JSX.Element {
  return (
    <svg aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <rect height="11" rx="1.8" width="18" x="3" y={active ? '7' : '6'} />
      <path d={active ? 'M6 6h12' : 'M3 17h18'} />
    </svg>
  )
}

function FullscreenModeIcon({ active }: { active: boolean }): React.JSX.Element {
  const paths = active
    ? ['M9 5v4H5', 'M15 5v4h4', 'M9 19v-4H5', 'M15 19v-4h4']
    : ['M8 5H5v3', 'M16 5h3v3', 'M8 19H5v-3', 'M16 19h3v-3']

  return (
    <svg aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
      {paths.map((path) => (
        <path key={path} d={path} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  )
}

function ActionFeedbackOverlay({ hint }: { hint: ActionHint | null }): React.JSX.Element | null {
  if (!hint) return null
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
        <div className="flex flex-col items-center gap-2 rounded-xl bg-black/55 px-6 py-4 text-white shadow-lg shadow-black/30 backdrop-blur-sm">
          <Rewind size={32} />
          <span className="text-base font-semibold tabular-nums">-{hint.seconds}s</span>
        </div>
      </div>
    )
  }
  if (hint.type === 'seek-forward') {
    return (
      <div className="pointer-events-none absolute inset-y-0 right-0 z-30 flex items-center pr-10">
        <div className="flex flex-col items-center gap-2 rounded-xl bg-black/55 px-6 py-4 text-white shadow-lg shadow-black/30 backdrop-blur-sm">
          <FastForward size={32} />
          <span className="text-base font-semibold tabular-nums">+{hint.seconds}s</span>
        </div>
      </div>
    )
  }
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
      <div className="flex items-center gap-3 rounded-xl bg-black/55 px-6 py-4 text-white shadow-lg shadow-black/30 backdrop-blur-sm">
        <VolumeIcon muted={hint.percent === 0} volume={hint.percent / 100} />
        <span className="text-xl font-semibold tabular-nums">{hint.percent}%</span>
      </div>
    </div>
  )
}

function readStoredSeekStep(): number {
  const parsed = Number(window.localStorage.getItem(SEEK_STEP_STORAGE_KEY))
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(300, Math.max(1, Math.round(parsed)))
    : DEFAULT_SEEK_STEP_SECONDS
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`
}

function formatRate(rate: number): string {
  return `${rate.toFixed(2)}x`
}

function getPointerVolumePercent(element: HTMLElement, clientX: number): number {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0) return 0

  const ratio = (clientX - rect.left) / rect.width
  return Math.round(Math.min(1, Math.max(0, ratio)) * 100)
}

function isArrowKey(key: string): key is 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' {
  return key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight'
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
}
