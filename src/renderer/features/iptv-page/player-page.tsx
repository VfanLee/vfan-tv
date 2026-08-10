import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Loader2, Radio, RotateCcw } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import type {
  IptvChannelPrograms,
  IptvEpgProgram,
  IptvPlaybackTarget,
  IptvPlaylist,
  IptvProgramScheduleResult,
} from '@shared/types'
import { BasicPlayer, type PlayerRuntimeInfo } from '@renderer/components'
import {
  getIptvCatalog,
  getIptvPlaybackTarget,
  getIptvPrograms,
  getIptvProgramSchedule,
  releaseMediaPlaybackSession,
  reportMediaPlaybackEvent,
} from '@renderer/platform/api'
import { Button } from '@/ui/button'
import { PlaybackInfoOverlay } from './components/playback-info-overlay'
import { IptvGuidePanel } from './components/iptv-guide-panel'
import { ProgramScheduleOverlay } from './components/program-schedule-overlay'

export function IptvPlayerPage(): React.JSX.Element {
  const { sourceId = '', channelId = '' } = useParams()
  const navigate = useNavigate()
  const attemptedStreamsRef = useRef(new Set<string>())
  const failoverTimerRef = useRef<number | undefined>(undefined)
  const mediaSessionIdRef = useRef<string | undefined>(undefined)
  const pendingRouteSwitchRef = useRef<'manual-route-switch' | 'auto-route-switch' | undefined>(undefined)
  const [playlist, setPlaylist] = useState<IptvPlaylist>()
  const [streamId, setStreamId] = useState('')
  const [playback, setPlayback] = useState<{
    channelId: string
    streamId: string
    target: IptvPlaybackTarget
  }>()
  const [programState, setProgramState] = useState<{
    sourceId: string
    channelId: string
    value?: IptvChannelPrograms
  }>()
  const [scheduleState, setScheduleState] = useState<{
    sourceId: string
    channelId: string
    value: IptvProgramScheduleResult
  }>()
  const [guideNow, setGuideNow] = useState(() => Date.now())
  const [runtimeInfo, setRuntimeInfo] = useState<PlayerRuntimeInfo>({})
  const [failedStreamIds, setFailedStreamIds] = useState<ReadonlySet<string>>(new Set())
  const [routeListOpen, setRouteListOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [retryKey, setRetryKey] = useState(0)
  const [pageError, setPageError] = useState<string>()
  const [playbackError, setPlaybackError] = useState<string>()
  const channel = playlist?.channels.find((item) => item.id === channelId)
  const stream = channel?.streams.find((item) => item.id === streamId) ?? channel?.streams[0]
  const target =
    playback && playback.channelId === channel?.id && playback.streamId === stream?.id ? playback.target : undefined
  const streamType = target?.streamType
  const programs =
    programState && programState.sourceId === sourceId && programState.channelId === channel?.id
      ? programState.value
      : undefined
  const todaySchedule =
    scheduleState && scheduleState.sourceId === sourceId && scheduleState.channelId === channel?.id
      ? scheduleState.value
      : undefined
  const guidePrograms = todaySchedule?.programs ?? compactPrograms(programs)

  useEffect(() => {
    const timer = window.setInterval(() => setGuideNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const handlePlaybackFailure = useCallback(
    (reason: string): void => {
      if (!channel || !stream) return
      window.clearTimeout(failoverTimerRef.current)
      attemptedStreamsRef.current.add(stream.id)
      setFailedStreamIds(new Set(attemptedStreamsRef.current))
      const next = channel.streams.find((item) => !attemptedStreamsRef.current.has(item.id))
      if (next) {
        pendingRouteSwitchRef.current = 'auto-route-switch'
        toast.warning('当前线路不可用，正在自动换线', { description: `${stream.name}：${reason}` })
        setRuntimeInfo({})
        setPlayback(undefined)
        setStreamId(next.id)
        return
      }
      const pendingSwitch = pendingRouteSwitchRef.current
      const mediaSessionId = mediaSessionIdRef.current
      if (pendingSwitch && mediaSessionId) {
        void reportMediaPlaybackEvent({ mediaSessionId, type: pendingSwitch, success: false, message: reason })
      }
      pendingRouteSwitchRef.current = undefined
      setPlaybackError(`该频道的全部线路均不可用：${reason}`)
    },
    [channel, stream],
  )

  useEffect(() => {
    let active = true
    void getIptvCatalog(sourceId)
      .then((catalog) => {
        if (!active) return
        setPlaylist(catalog)
        const selected = catalog.channels.find((item) => item.id === channelId)
        if (!selected) throw new Error('频道不存在，可能已从 IPTV 源中移除')
        if (!selected.streams.length) throw new Error('该频道没有可播放线路')
        attemptedStreamsRef.current.clear()
        setFailedStreamIds(new Set())
        setPlayback(undefined)
        setRuntimeInfo({})
        setPlaybackError(undefined)
        setStreamId(selected.streams[0].id)
      })
      .catch((error: unknown) => {
        if (active) setPageError(toErrorMessage(error))
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [channelId, retryKey, sourceId])

  useEffect(() => {
    if (!channel) return
    let active = true
    void getIptvPrograms(sourceId, [channel.id])
      .then((result) => {
        if (active) setProgramState({ sourceId, channelId: channel.id, value: result.items[0] })
      })
      .catch(() => {
        if (active) setProgramState({ sourceId, channelId: channel.id })
      })
    return () => {
      active = false
    }
  }, [channel, sourceId])

  useEffect(() => {
    if (!channel) return
    let active = true
    void getIptvProgramSchedule(sourceId, channel.id, formatDateKey(new Date()))
      .then((result) => {
        if (active) setScheduleState({ sourceId, channelId: channel.id, value: result })
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [channel, sourceId])

  useEffect(() => {
    if (!channel || !stream) return
    let active = true
    void getIptvPlaybackTarget(sourceId, channel.id, stream.id)
      .then((nextTarget) => {
        if (!active) {
          void releaseMediaPlaybackSession(nextTarget.mediaSessionId)
          return
        }
        setPlayback({ channelId: channel.id, streamId: stream.id, target: nextTarget })
      })
      .catch((error: unknown) => {
        if (active) handlePlaybackFailure(toErrorMessage(error))
      })
    return () => {
      active = false
    }
  }, [channel, handlePlaybackFailure, sourceId, stream])

  useEffect(() => {
    mediaSessionIdRef.current = target?.mediaSessionId
    return () => {
      const mediaSessionId = target?.mediaSessionId
      if (mediaSessionId) void releaseMediaPlaybackSession(mediaSessionId)
      if (mediaSessionIdRef.current === mediaSessionId) mediaSessionIdRef.current = undefined
    }
  }, [target?.mediaSessionId])

  useEffect(() => {
    window.clearTimeout(failoverTimerRef.current)
    if (!stream || !target || !streamType) return
    failoverTimerRef.current = window.setTimeout(() => handlePlaybackFailure('8 秒内未出现首帧'), 8_000)
    return () => window.clearTimeout(failoverTimerRef.current)
  }, [handlePlaybackFailure, stream, streamType, target])

  const selectStream = (nextStreamId: string): void => {
    if (nextStreamId === stream?.id) {
      setRouteListOpen(false)
      return
    }
    attemptedStreamsRef.current.clear()
    setFailedStreamIds(new Set())
    setPlaybackError(undefined)
    setRuntimeInfo({})
    pendingRouteSwitchRef.current = 'manual-route-switch'
    setPlayback(undefined)
    setRouteListOpen(false)
    setStreamId(nextStreamId)
  }

  const handlePlaybackReady = useCallback((): void => {
    window.clearTimeout(failoverTimerRef.current)
    if (!stream) return

    if (attemptedStreamsRef.current.delete(stream.id)) {
      setFailedStreamIds(new Set(attemptedStreamsRef.current))
    }
    const pendingSwitch = pendingRouteSwitchRef.current
    const mediaSessionId = mediaSessionIdRef.current
    if (pendingSwitch && mediaSessionId) {
      void reportMediaPlaybackEvent({ mediaSessionId, type: pendingSwitch, success: true })
    }
    pendingRouteSwitchRef.current = undefined
    setPlaybackError(undefined)
  }, [stream])

  const handleRuntimeInfo = useCallback(
    (info: PlayerRuntimeInfo): void => {
      setRuntimeInfo(info)
      if (info.firstFrameMs) handlePlaybackReady()
    },
    [handlePlaybackReady],
  )

  const retryPlayback = (): void => {
    window.clearTimeout(failoverTimerRef.current)
    attemptedStreamsRef.current.clear()
    pendingRouteSwitchRef.current = undefined
    setFailedStreamIds(new Set())
    setPlaylist(undefined)
    setStreamId('')
    setPlayback(undefined)
    setRuntimeInfo({})
    setIsLoading(true)
    setPageError(undefined)
    setPlaybackError(undefined)
    setRetryKey((value) => value + 1)
  }

  const overlay = channel ? (
    <div className="vfan-iptv-fullscreen-only">
      <PlaybackInfoOverlay
        sourceId={sourceId}
        channel={channel}
        currentStream={stream}
        runtimeInfo={runtimeInfo}
        programs={programs}
        failedStreamIds={failedStreamIds}
        open={routeListOpen}
        onOpenChange={(open) => {
          setScheduleOpen(false)
          setRouteListOpen(open)
        }}
        onSelectStream={selectStream}
      />
    </div>
  ) : null

  return (
    <div className="bg-background flex h-full min-h-0 flex-col overflow-hidden">
      <header className="border-border bg-background/95 flex h-14 shrink-0 items-center gap-3 border-b px-3 backdrop-blur sm:px-5">
        <Button aria-label="返回" className="-ml-1 gap-2" variant="ghost" onClick={() => navigate('/iptv')}>
          <ArrowLeft className="size-4" />
          <span>返回</span>
        </Button>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
        <BasicPlayer
          autoPlay
          className="size-full"
          enableAutoNext={false}
          hidePlaybackSettings
          isResolvingSource={Boolean(stream && !target)}
          loop={stream?.isLive === false}
          mediaSessionId={target?.mediaSessionId}
          persistPlaybackSettings={false}
          playerOverlay={overlay}
          playerOverlayPinned={routeListOpen}
          showMediaTrackSettings
          sourceType={streamType}
          src={target && streamType ? target.src : undefined}
          title={channel?.title}
          variant={stream?.isLive === false ? 'vod' : 'live'}
          onPlaybackError={handlePlaybackFailure}
          onPlaybackReady={handlePlaybackReady}
          onRuntimeInfoChange={handleRuntimeInfo}
          onSettingsVisibilityChange={(visible) => {
            if (!visible) return
            setRouteListOpen(false)
            setScheduleOpen(false)
          }}
        />

        {isLoading ? (
          <PlayerState>
            <Loader2 className="size-6 animate-spin" />
            <span>正在加载频道…</span>
          </PlayerState>
        ) : pageError || playbackError ? (
          <PlayerState>
            <span className="flex size-12 items-center justify-center rounded-2xl bg-white/10">
              <Radio className="size-5" />
            </span>
            <div className="max-w-lg text-center">
              <h1 className="text-lg font-semibold text-white">无法播放频道</h1>
              <p className="mt-2 text-sm leading-6 text-white/55">{pageError ?? playbackError}</p>
            </div>
            <Button className="mt-2" variant="secondary" onClick={retryPlayback}>
              <RotateCcw className="size-4" />
              重试
            </Button>
          </PlayerState>
        ) : null}
      </div>

      {channel ? (
        <>
          <IptvGuidePanel
            sourceId={sourceId}
            channel={channel}
            currentStream={stream}
            runtimeInfo={runtimeInfo}
            programs={guidePrograms}
            failedStreamIds={failedStreamIds}
            now={guideNow}
            onOpenSchedule={() => {
              setRouteListOpen(false)
              setScheduleOpen(true)
            }}
            onSelectStream={selectStream}
          />
          <ProgramScheduleOverlay
            key={`${sourceId}:${channel.id}:${todaySchedule?.date ?? 'pending'}`}
            sourceId={sourceId}
            channelId={channel.id}
            channelTitle={channel.title}
            initialResult={todaySchedule}
            open={scheduleOpen}
            onClose={() => setScheduleOpen(false)}
          />
        </>
      ) : null}
    </div>
  )
}

function PlayerState({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="absolute inset-0 z-[220] flex flex-col items-center justify-center gap-4 bg-black text-white/65">
      {children}
    </div>
  )
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function compactPrograms(programs?: IptvChannelPrograms): IptvEpgProgram[] {
  return [programs?.current, programs?.next].filter((program): program is IptvEpgProgram => Boolean(program))
}

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
