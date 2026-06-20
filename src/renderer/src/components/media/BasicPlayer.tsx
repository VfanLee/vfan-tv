import { useCallback, useMemo, useRef, useState } from 'react'
import {
  MediaPlayer,
  MediaProvider,
  isHLSProvider,
  type MediaErrorDetail,
  type MediaPlayerInstance,
  type PlayerSrc,
} from '@vidstack/react'
import { cn } from '@renderer/lib/utils'
import { createFilteredHlsLoader } from '@renderer/lib/hls-playlist-filter'
import { PlayerChrome } from './player/PlayerChrome'
import type { PlayerErrorLog } from './player/types'

const MAX_ERROR_LOGS = 100
const HLS_MIME_TYPE = 'application/x-mpegurl' as const
const HLS_PLAYLIST_FILTER_STORAGE_KEY = 'enable_blockad'

export interface BasicPlayerProps {
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
  const playerRef = useRef<MediaPlayerInstance | null>(null)
  const errorLogIdRef = useRef(0)
  const retryTimeRef = useRef(0)
  const resumeAfterReloadRef = useRef(false)
  const appliedLoadKeyRef = useRef('')
  const [reloadNonce, setReloadNonce] = useState(0)
  const [playlistFilteringEnabled, setPlaylistFilteringEnabled] = useState(() => readPlaylistFilteringEnabled())
  const [playbackSettings, setPlaybackSettings] = useState({ playbackRate: 1, volume: 0.8, muted: false })
  const [errorState, setErrorState] = useState<{ src: string | undefined; logs: PlayerErrorLog[] }>({
    src,
    logs: [],
  })
  const playerSrc = useMemo<PlayerSrc | undefined>(() => getPlayerSource(src), [src])
  const errorLogs = errorState.src === src ? errorState.logs : []
  const loadKey = `${src ?? ''}:${reloadNonce}`

  const appendErrorLog = useCallback(
    (source: PlayerErrorLog['source'], message: string, fatal: boolean): void => {
      errorLogIdRef.current += 1
      const nextLog: PlayerErrorLog = {
        id: errorLogIdRef.current,
        timestamp: Date.now(),
        source,
        message,
        fatal,
      }

      setErrorState((current) => {
        const currentLogs = current.src === src ? current.logs : []
        return { src, logs: [...currentLogs.slice(-(MAX_ERROR_LOGS - 1)), nextLog] }
      })
    },
    [src],
  )

  const retryPlayback = (): void => {
    retryTimeRef.current = playerRef.current?.currentTime ?? 0
    appliedLoadKeyRef.current = ''
    setReloadNonce((current) => current + 1)
  }

  const togglePlaylistFiltering = useCallback((): void => {
    const nextEnabled = !playlistFilteringEnabled
    window.localStorage.setItem(HLS_PLAYLIST_FILTER_STORAGE_KEY, String(nextEnabled))

    if (isHlsSource(src)) {
      retryTimeRef.current = playerRef.current?.currentTime ?? 0
      resumeAfterReloadRef.current = true
      appliedLoadKeyRef.current = ''
      setReloadNonce((current) => current + 1)
    }

    setPlaylistFilteringEnabled(nextEnabled)
  }, [playlistFilteringEnabled, src])

  const handlePlaybackRateChange = useCallback((playbackRate: number): void => {
    setPlaybackSettings((current) => ({ ...current, playbackRate }))
  }, [])

  const applyStartTime = (duration: number): void => {
    const player = playerRef.current
    if (!player || appliedLoadKeyRef.current === loadKey || !Number.isFinite(duration) || duration <= 0) {
      return
    }

    const requestedTime = retryTimeRef.current > 0 ? retryTimeRef.current : initialTime
    if (requestedTime > 0 && requestedTime < duration) {
      player.currentTime = requestedTime
    }

    retryTimeRef.current = 0
    appliedLoadKeyRef.current = loadKey

    if (resumeAfterReloadRef.current) {
      resumeAfterReloadRef.current = false
      void player.play()
    }
  }

  const reportProgress = (currentTime: number, duration: number): void => {
    onProgress?.({
      currentTime: Math.floor(currentTime),
      duration: Number.isFinite(duration) ? Math.floor(duration) : 0,
    })
  }

  const reportMediaError = (detail: MediaErrorDetail): void => {
    appendErrorLog(
      'MediaProvider',
      detail.message || (detail.code ? `媒体加载失败，错误代码 ${detail.code}` : '播放器加载失败'),
      true,
    )
  }

  if (!src || !playerSrc) {
    return (
      <div
        className={cn(
          'text-muted-foreground flex h-full w-full items-center justify-center bg-black text-sm',
          className,
        )}
      >
        请选择一个可播放剧集
      </div>
    )
  }

  return (
    <MediaPlayer
      key={loadKey}
      ref={playerRef}
      autoPlay={autoPlay}
      className={cn('group/player relative h-full w-full overflow-hidden bg-black outline-none', className)}
      controlsDelay={2000}
      hideControlsOnMouseLeave
      keyDisabled
      load="eager"
      logLevel="warn"
      muted={playbackSettings.muted}
      playbackRate={playbackSettings.playbackRate}
      playsInline
      preload="metadata"
      src={playerSrc}
      title={title ?? 'VfanTV 播放器'}
      volume={playbackSettings.volume}
      onCanPlay={(detail) => applyStartTime(detail.duration)}
      onEnded={() => onEnded?.()}
      onError={reportMediaError}
      onHlsError={(detail) => {
        const message = `${detail.type}: ${detail.details}${detail.error?.message ? ` - ${detail.error.message}` : ''}`
        appendErrorLog('HLS', message, detail.fatal)
      }}
      onProviderChange={(provider) => {
        if (isHLSProvider(provider)) {
          provider.library = async () => {
            const hlsLibrary = await import('hls.js')
            if (playlistFilteringEnabled) {
              provider.config = {
                ...provider.config,
                loader: createFilteredHlsLoader(hlsLibrary.default),
              }
            }
            return hlsLibrary
          }
        }
      }}
      onRateChange={(playbackRate) => {
        setPlaybackSettings((current) => ({ ...current, playbackRate }))
      }}
      onTimeUpdate={(detail) => reportProgress(detail.currentTime, playerRef.current?.duration ?? 0)}
      onVolumeChange={(detail) => {
        setPlaybackSettings((current) => ({
          ...current,
          muted: detail.muted,
          volume: detail.volume,
        }))
      }}
    >
      <MediaProvider className="pointer-events-none absolute inset-0 h-full w-full bg-black [&>video]:h-full [&>video]:w-full [&>video]:object-contain" />
      <PlayerChrome
        errorLogs={errorLogs}
        hasNextEpisode={hasNextEpisode}
        hasPreviousEpisode={hasPreviousEpisode}
        isTheaterMode={isTheaterMode}
        playlistFilteringEnabled={playlistFilteringEnabled}
        playerRef={playerRef}
        src={src}
        title={title}
        onNextEpisode={onNextEpisode}
        onPlaybackRateChange={handlePlaybackRateChange}
        onPreviousEpisode={onPreviousEpisode}
        onRetry={retryPlayback}
        onToggleTheaterMode={onToggleTheaterMode}
        onTogglePlaylistFiltering={togglePlaylistFiltering}
      />
    </MediaPlayer>
  )
}

function isHlsSource(src: string | undefined): boolean {
  return Boolean(src && /\.m3u8(?:$|[?#])/i.test(src))
}

function readPlaylistFilteringEnabled(): boolean {
  return window.localStorage.getItem(HLS_PLAYLIST_FILTER_STORAGE_KEY) !== 'false'
}

function getPlayerSource(src: string | undefined): PlayerSrc | undefined {
  if (!src) {
    return undefined
  }

  if (isHlsSource(src)) {
    return { src, type: HLS_MIME_TYPE }
  }

  return src
}
