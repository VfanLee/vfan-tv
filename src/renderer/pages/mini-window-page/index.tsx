import { useCallback, useEffect, useRef, useState } from 'react'
import { EyeOff, LogOut, Pause, Pin, PinOff, Play, RotateCcw } from 'lucide-react'
import { clamp } from 'es-toolkit/math'
import type {
  MiniWindowBounds,
  MiniWindowPlaybackContext,
  MiniWindowResizeCorner,
  RadioMiniWindowPlaybackContext,
  RadioMiniWindowPlaybackExit,
  VideoMiniWindowPlaybackContext,
} from '@shared/types'
import {
  BasicPlayer,
  RadioPlaybackControlIcon,
  RadioStreamEngine,
  useRadioProgramRefresh,
  type MiniWindowPlayerController,
  type MiniWindowPlayerState,
} from '@renderer/components'
import {
  exitMiniWindowMode,
  getMiniWindowAlwaysOnTop,
  getMiniWindowPlayback,
  hideMiniWindow,
  moveMiniWindow,
  releaseMediaPlaybackSession,
  resizeMiniWindow,
  setMiniWindowAlwaysOnTop,
  updateMiniWindowPlayback,
} from '@renderer/platform/api'
import type { RadioPlaybackCommand, RadioPlaybackStatus } from '@/stores/radio-player'
import { cn } from '@/utils'

interface MiniWindowSizeConfig {
  aspectRatio: number
  minWidth: number
  maxWidth: number
}

/** 视频迷你窗口的默认和最小尺寸约束 */
const VIDEO_SIZE_CONFIG: MiniWindowSizeConfig = {
  aspectRatio: 16 / 9,
  minWidth: 200,
  maxWidth: 960,
}

/** 电台迷你窗口的默认和最小尺寸约束 */
const RADIO_SIZE_CONFIG: MiniWindowSizeConfig = {
  aspectRatio: 184 / 44,
  minWidth: 184,
  maxWidth: 184,
}

interface ResizeGesture {
  pointerId: number
  corner: MiniWindowResizeCorner
  pointerX: number
  pointerY: number
  bounds: MiniWindowBounds
}

interface MoveGesture {
  pointerId: number
  pointerX: number
  pointerY: number
  x: number
  y: number
}

/** 渲染迷你窗口页面 */
export function MiniWindowPage(): React.JSX.Element {
  const [playback, setPlayback] = useState<MiniWindowPlaybackContext | undefined>(undefined)
  const [isHovering, setIsHovering] = useState(false)
  const currentTimeRef = useRef(0)
  const radioExitRef = useRef<RadioMiniWindowPlaybackExit | undefined>(undefined)
  const lastReportedTimeRef = useRef(-1)
  const resizeGestureRef = useRef<ResizeGesture | undefined>(undefined)
  const moveGestureRef = useRef<MoveGesture | undefined>(undefined)
  const playerControllerRef = useRef<MiniWindowPlayerController | null>(null)
  const [playerState, setPlayerState] = useState<MiniWindowPlayerState>({
    isPlaying: true,
    isMuted: false,
  })
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false)
  const [isAlwaysOnTopUpdating, setIsAlwaysOnTopUpdating] = useState(false)

  /** 设置迷你窗口透明背景并在卸载时恢复 */
  useEffect(() => {
    const root = document.getElementById('root')
    const previousHtmlBackground = document.documentElement.style.background
    const previousBodyBackground = document.body.style.background
    const previousRootBackground = root?.style.background ?? ''

    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    if (root) root.style.background = 'transparent'

    return () => {
      document.documentElement.style.background = previousHtmlBackground
      document.body.style.background = previousBodyBackground
      if (root) root.style.background = previousRootBackground
    }
  }, [])

  /** 加载迷你窗口播放内容和置顶状态 */
  useEffect(() => {
    void getMiniWindowPlayback().then((context) => {
      if (!context) return
      if (context.variant === 'radio') {
        radioExitRef.current = createInitialRadioExit(context)
      } else {
        currentTimeRef.current = context.initialTime
      }
      setPlayback(context)
      void getMiniWindowAlwaysOnTop(context.sessionId).then(setIsAlwaysOnTop)
    })
  }, [])

  /** 播放内容变化或组件卸载时释放媒体会话 */
  useEffect(() => {
    const mediaSessionId = playback?.variant === 'radio' ? undefined : playback?.mediaSessionId
    return () => {
      if (mediaSessionId) void releaseMediaPlaybackSession(mediaSessionId)
    }
  }, [playback])

  /** 退出迷你窗口模式 */
  const leaveMiniWindowMode = useCallback((): void => {
    if (!playback) return
    if (playback.variant === 'radio') {
      void exitMiniWindowMode(radioExitRef.current ?? createInitialRadioExit(playback))
      return
    }
    void exitMiniWindowMode({
      sessionId: playback.sessionId,
      variant: playback.variant,
      currentTime: currentTimeRef.current,
    })
  }, [playback])

  /** 开始缩放 */
  const startResize = (corner: MiniWindowResizeCorner, event: React.PointerEvent<HTMLDivElement>): void => {
    if (!playback) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeGestureRef.current = {
      pointerId: event.pointerId,
      corner,
      pointerX: event.screenX,
      pointerY: event.screenY,
      bounds: {
        x: window.screenX,
        y: window.screenY,
        width: window.innerWidth,
        height: window.innerHeight,
      },
    }
  }

  /** 根据指针位置调整迷你窗口尺寸 */
  const resize = (event: React.PointerEvent<HTMLDivElement>): void => {
    const gesture = resizeGestureRef.current
    if (!playback || !gesture || gesture.pointerId !== event.pointerId) return
    const config = playback.variant === 'radio' ? RADIO_SIZE_CONFIG : VIDEO_SIZE_CONFIG
    const horizontalChange = isLeftCorner(gesture.corner)
      ? gesture.pointerX - event.screenX
      : event.screenX - gesture.pointerX
    const verticalChange = isTopCorner(gesture.corner)
      ? (gesture.pointerY - event.screenY) * config.aspectRatio
      : (event.screenY - gesture.pointerY) * config.aspectRatio
    const width = clamp(
      Math.round(
        gesture.bounds.width +
          (Math.abs(horizontalChange) >= Math.abs(verticalChange) ? horizontalChange : verticalChange),
      ),
      config.minWidth,
      config.maxWidth,
    )
    const height = Math.round(width / config.aspectRatio)
    const bounds = getResizedBounds(gesture.corner, gesture.bounds, width, height)
    void resizeMiniWindow({ sessionId: playback.sessionId, corner: gesture.corner, bounds })
  }

  /** 停止缩放 */
  const stopResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    const gesture = resizeGestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    resizeGestureRef.current = undefined
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }

  /** 开始拖动迷你窗口 */
  const startMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!playback || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    moveGestureRef.current = {
      pointerId: event.pointerId,
      pointerX: event.screenX,
      pointerY: event.screenY,
      x: window.screenX,
      y: window.screenY,
    }
  }

  /** 根据指针位置移动迷你窗口 */
  const move = (event: React.PointerEvent<HTMLDivElement>): void => {
    const gesture = moveGestureRef.current
    if (!playback || !gesture || gesture.pointerId !== event.pointerId) return
    void moveMiniWindow({
      sessionId: playback.sessionId,
      position: {
        x: gesture.x + event.screenX - gesture.pointerX,
        y: gesture.y + event.screenY - gesture.pointerY,
      },
    })
  }

  /** 结束迷你窗口拖动 */
  const stopMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const gesture = moveGestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    moveGestureRef.current = undefined
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }

  /** 绑定迷你窗口退出和视频快进快捷键 */
  useEffect(() => {
    /** 处理键盘按键事件 */
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        leaveMiniWindowMode()
        return
      }
      if (
        !playback ||
        playback.variant === 'radio' ||
        playback.variant === 'live' ||
        (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return
      }
      const controller = playerControllerRef.current
      if (!controller) return
      event.preventDefault()
      controller.seekBy(event.key === 'ArrowRight' ? 5 : -5)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [leaveMiniWindowMode, playback])

  if (!playback) return <main className="fixed inset-0 bg-transparent" />

  const showWindowActions = isHovering

  return (
    <main
      className={cn(
        'fixed inset-0 overflow-hidden',
        playback.variant === 'radio' ? 'text-foreground bg-transparent' : 'bg-black',
      )}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {playback.variant === 'radio' ? (
        <RadioMiniWindowPlayer
          isAlwaysOnTop={isAlwaysOnTop}
          isAlwaysOnTopUpdating={isAlwaysOnTopUpdating}
          playback={playback}
          onExit={leaveMiniWindowMode}
          onExitChange={(exit) => {
            radioExitRef.current = exit
          }}
          onHide={() => {
            void hideMiniWindow(playback.sessionId)
          }}
          onToggleAlwaysOnTop={() => {
            if (isAlwaysOnTopUpdating) return
            setIsAlwaysOnTopUpdating(true)
            void setMiniWindowAlwaysOnTop(playback.sessionId, !isAlwaysOnTop)
              .then(setIsAlwaysOnTop)
              .finally(() => setIsAlwaysOnTopUpdating(false))
          }}
        />
      ) : (
        <VideoMiniWindowPlayer
          playback={playback}
          playerControllerRef={playerControllerRef}
          onPlayerStateChange={setPlayerState}
          onProgress={(currentTime) => {
            currentTimeRef.current = currentTime
            if (lastReportedTimeRef.current === currentTime) return
            lastReportedTimeRef.current = currentTime
            void updateMiniWindowPlayback({
              sessionId: playback.sessionId,
              variant: playback.variant,
              currentTime,
            })
          }}
        />
      )}

      <div
        aria-hidden="true"
        className="absolute inset-0 z-10 cursor-grab [-webkit-app-region:no-drag] active:cursor-grabbing"
        onLostPointerCapture={stopMove}
        onPointerCancel={stopMove}
        onPointerDown={startMove}
        onPointerMove={move}
        onPointerUp={stopMove}
      />

      {playback.variant !== 'radio' ? (
        <div
          className={cn(
            'absolute top-[clamp(10px,3vw,14px)] right-[clamp(10px,3vw,14px)] z-30 flex gap-1.5 transition-opacity duration-150 [-webkit-app-region:no-drag] motion-reduce:transition-none',
            showWindowActions ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        >
          <MiniWindowActionButton
            label="隐藏小窗"
            onClick={() => {
              void hideMiniWindow(playback.sessionId)
            }}
          >
            <EyeOff />
          </MiniWindowActionButton>
          <MiniWindowActionButton
            disabled={isAlwaysOnTopUpdating}
            label={isAlwaysOnTop ? '取消置顶' : '置顶显示'}
            onClick={() => {
              if (isAlwaysOnTopUpdating) return
              setIsAlwaysOnTopUpdating(true)
              void setMiniWindowAlwaysOnTop(playback.sessionId, !isAlwaysOnTop)
                .then(setIsAlwaysOnTop)
                .finally(() => setIsAlwaysOnTopUpdating(false))
            }}
          >
            {isAlwaysOnTop ? <Pin /> : <PinOff />}
          </MiniWindowActionButton>
          <MiniWindowActionButton label="退出小窗播放" onClick={leaveMiniWindowMode}>
            <LogOut />
          </MiniWindowActionButton>
        </div>
      ) : null}

      {playback.variant !== 'radio' ? (
        <button
          type="button"
          aria-label={playerState.isPlaying ? '暂停播放' : '继续播放'}
          className={cn(
            'absolute top-1/2 left-1/2 z-30 flex size-[clamp(36px,14vw,56px)] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[clamp(10px,4vw,18px)] bg-black/45 text-white transition-[opacity,background-color] duration-150 [-webkit-app-region:no-drag] hover:bg-black/65 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none motion-reduce:transition-none',
            isHovering ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
          onClick={() => playerControllerRef.current?.togglePlayback()}
        >
          {playerState.isPlaying ? (
            <Pause className="size-[clamp(18px,7vw,26px)]" aria-hidden="true" />
          ) : (
            <Play className="size-[clamp(18px,7vw,26px)]" aria-hidden="true" />
          )}
        </button>
      ) : null}

      {playback.variant !== 'radio'
        ? (['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((corner) => (
            <div
              key={corner}
              aria-hidden="true"
              className={getResizeHandleClassName(corner)}
              onLostPointerCapture={stopResize}
              onPointerCancel={stopResize}
              // 缩放手柄在指针事件中读取拖拽 ref。
              // eslint-disable-next-line react-hooks/refs
              onPointerDown={(event) => startResize(corner, event)}
              onPointerMove={resize}
              onPointerUp={stopResize}
            />
          ))
        : null}
    </main>
  )
}

/** 渲染视频迷你窗口播放器 */
function VideoMiniWindowPlayer({
  playback,
  playerControllerRef,
  onPlayerStateChange,
  onProgress,
}: {
  playback: VideoMiniWindowPlaybackContext
  playerControllerRef: React.MutableRefObject<MiniWindowPlayerController | null>
  onPlayerStateChange: (state: MiniWindowPlayerState) => void
  onProgress: (currentTime: number) => void
}): React.JSX.Element {
  return (
    <BasicPlayer
      autoPlay
      audioTrackUrl={playback.audioTrackUrl}
      className="h-full"
      enableAutoNext={false}
      initialTime={playback.initialTime}
      loop={playback.loop}
      mediaSessionId={playback.mediaSessionId}
      miniWindowMode
      persistPlaybackSettings={false}
      sourceType={playback.sourceType}
      src={playback.src}
      title={playback.title}
      variant={playback.variant}
      onMiniWindowControllerReady={(controller) => {
        playerControllerRef.current = controller
      }}
      onMiniWindowPlayerStateChange={onPlayerStateChange}
      onProgress={({ currentTime }) => onProgress(currentTime)}
    />
  )
}

/** 渲染电台迷你窗口播放器 */
function RadioMiniWindowPlayer({
  isAlwaysOnTop,
  isAlwaysOnTopUpdating,
  playback,
  onExit,
  onExitChange,
  onHide,
  onToggleAlwaysOnTop,
}: {
  isAlwaysOnTop: boolean
  isAlwaysOnTopUpdating: boolean
  playback: RadioMiniWindowPlaybackContext
  onExit: () => void
  onExitChange: (exit: RadioMiniWindowPlaybackExit) => void
  onHide: () => void
  onToggleAlwaysOnTop: () => void
}): React.JSX.Element {
  const [channel, setChannel] = useState(playback.channel)
  const [command, setCommand] = useState<RadioPlaybackCommand>('play')
  const [commandId, setCommandId] = useState(1)
  const [isMuted] = useState(playback.isMuted)
  const [status, setStatus] = useState<RadioPlaybackStatus>('loading')
  const [volume] = useState(playback.volume)

  useRadioProgramRefresh(channel.id, (title) => {
    setChannel((current) => ({ ...current, nowPlayingTitle: title }))
  })

  /** 同步电台迷你窗口的退出播放状态 */
  useEffect(() => {
    const exit: RadioMiniWindowPlaybackExit = {
      sessionId: playback.sessionId,
      variant: 'radio',
      channel,
      isPlaying: ['loading', 'playing'].includes(status),
      isMuted,
      volume,
    }
    onExitChange(exit)
    void updateMiniWindowPlayback(exit)
  }, [channel, isMuted, onExitChange, playback.sessionId, status, volume])

  const isPlaying = status === 'playing'
  /** 执行电台播放器控制命令 */
  const runCommand = (nextCommand: RadioPlaybackCommand): void => {
    setCommand(nextCommand)
    setCommandId((current) => current + 1)
  }

  return (
    <>
      <RadioStreamEngine
        channel={channel}
        command={command}
        commandId={commandId}
        isMuted={isMuted}
        volume={volume}
        onError={() => setStatus('error')}
        onStatusChange={(nextStatus) => {
          setStatus(nextStatus)
        }}
      />
      <section
        aria-label="电台小窗播放器"
        className="border-border/80 bg-background/95 absolute inset-0 z-20 flex items-center justify-center gap-1 rounded-[11px] border p-1 shadow-sm backdrop-blur-md [-webkit-app-region:no-drag]"
      >
        <RadioMiniWindowActionButton label="隐藏小窗" onClick={onHide}>
          <EyeOff />
        </RadioMiniWindowActionButton>
        <RadioMiniWindowActionButton
          disabled={isAlwaysOnTopUpdating}
          label={isAlwaysOnTop ? '取消置顶' : '置顶显示'}
          onClick={onToggleAlwaysOnTop}
        >
          {isAlwaysOnTop ? <Pin /> : <PinOff />}
        </RadioMiniWindowActionButton>
        {status === 'error' ? (
          <button
            aria-label="重试播放"
            className="group/playback focus-visible:ring-ring shrink-0 rounded-full outline-none focus-visible:ring-2"
            type="button"
            onClick={() => runCommand('retry')}
          >
            <span className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-full shadow-sm">
              <RotateCcw size={17} />
            </span>
          </button>
        ) : (
          <button
            aria-label={isPlaying || status === 'loading' ? '暂停播放' : '继续播放'}
            className="group/playback focus-visible:ring-ring shrink-0 rounded-full outline-none focus-visible:ring-2"
            type="button"
            onClick={() => runCommand(isPlaying || status === 'loading' ? 'pause' : 'play')}
          >
            <RadioPlaybackControlIcon
              className="size-9"
              state={status === 'loading' ? 'loading' : isPlaying ? 'pause' : 'play'}
            />
          </button>
        )}
        <RadioMiniWindowActionButton label="退出小窗播放" onClick={onExit}>
          <LogOut />
        </RadioMiniWindowActionButton>
      </section>
    </>
  )
}

/** 渲染电台迷你窗口操作按钮 */
function RadioMiniWindowActionButton({
  children,
  disabled = false,
  label,
  onClick,
}: MiniWindowActionButtonProps): React.JSX.Element {
  return (
    <button
      aria-label={label}
      className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring flex size-9 shrink-0 items-center justify-center rounded-full transition-colors outline-none focus-visible:ring-2 disabled:cursor-wait disabled:opacity-45 [&_svg]:size-[18px]"
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** 创建电台迷你窗口的初始退出状态 */
function createInitialRadioExit(playback: RadioMiniWindowPlaybackContext): RadioMiniWindowPlaybackExit {
  return {
    sessionId: playback.sessionId,
    variant: 'radio',
    channel: playback.channel,
    isPlaying: true,
    isMuted: playback.isMuted,
    volume: playback.volume,
  }
}

interface MiniWindowActionButtonProps {
  disabled?: boolean
  label: string
  children: React.ReactNode
  onClick: () => void
}

/** 渲染迷你窗口操作按钮 */
function MiniWindowActionButton({
  disabled = false,
  label,
  children,
  onClick,
}: MiniWindowActionButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      className="flex size-[clamp(26px,8vw,34px)] items-center justify-center rounded-[clamp(8px,2.5vw,12px)] bg-black/45 text-white transition-colors hover:bg-black/65 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none disabled:cursor-wait disabled:opacity-55 [&_svg]:size-[clamp(13px,4vw,18px)]"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** 判断缩放手柄是否位于左侧边角 */
function isLeftCorner(corner: MiniWindowResizeCorner): boolean {
  return corner === 'top-left' || corner === 'bottom-left'
}

/** 判断缩放手柄是否位于上侧边角 */
function isTopCorner(corner: MiniWindowResizeCorner): boolean {
  return corner === 'top-left' || corner === 'top-right'
}

/** 根据拖拽方向和指针位置计算窗口边界 */
function getResizedBounds(
  corner: MiniWindowResizeCorner,
  bounds: MiniWindowBounds,
  width: number,
  height: number,
): MiniWindowBounds {
  return {
    x: isLeftCorner(corner) ? bounds.x + bounds.width - width : bounds.x,
    y: isTopCorner(corner) ? bounds.y + bounds.height - height : bounds.y,
    width,
    height,
  }
}

/** 获取窗口缩放手柄的定位样式 */
function getResizeHandleClassName(corner: MiniWindowResizeCorner): string {
  const positions: Record<MiniWindowResizeCorner, string> = {
    'top-left': 'top-0 left-0 cursor-nwse-resize',
    'top-right': 'top-0 right-0 cursor-nesw-resize',
    'bottom-left': 'bottom-0 left-0 cursor-nesw-resize',
    'bottom-right': 'right-0 bottom-0 cursor-nwse-resize',
  }
  return `absolute z-40 size-3 [-webkit-app-region:no-drag] ${positions[corner]}`
}
