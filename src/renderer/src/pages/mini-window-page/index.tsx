import { useCallback, useEffect, useRef, useState } from 'react'
import { LogOut, Pause, Pin, PinOff, Play, Volume2, VolumeX } from 'lucide-react'
import type { MiniWindowPlaybackContext, MiniWindowResizeCorner, MiniWindowBounds } from '@shared/types'
import { BasicPlayer, type MiniWindowPlayerController, type MiniWindowPlayerState } from '@renderer/components'
import {
  exitMiniWindowMode,
  getMiniWindowAlwaysOnTop,
  getMiniWindowPlayback,
  moveMiniWindow,
  resizeMiniWindow,
  setMiniWindowAlwaysOnTop,
  updateMiniWindowPlayback,
} from '@renderer/services/api'

const MINI_WINDOW_ASPECT_RATIO = 16 / 9
const MINI_WINDOW_MIN_WIDTH = 200
const MINI_WINDOW_MAX_WIDTH = 960

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

// 独立窗口只负责播放和退出，不复用主界面的布局、边框或其他操作入口。
export function MiniWindowPage(): React.JSX.Element {
  const [playback, setPlayback] = useState<MiniWindowPlaybackContext | undefined>(undefined)
  const [isHovering, setIsHovering] = useState(false)
  const currentTimeRef = useRef(0)
  const lastReportedTimeRef = useRef(-1)
  const resizeGestureRef = useRef<ResizeGesture | undefined>(undefined)
  const moveGestureRef = useRef<MoveGesture | undefined>(undefined)
  const playerControllerRef = useRef<MiniWindowPlayerController | null>(null)
  const [playerState, setPlayerState] = useState<MiniWindowPlayerState>({ isPlaying: true, isMuted: false })
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false)
  const [isAlwaysOnTopUpdating, setIsAlwaysOnTopUpdating] = useState(false)

  useEffect(() => {
    void getMiniWindowPlayback().then((context) => {
      if (!context) return
      currentTimeRef.current = context.initialTime
      setPlayback(context)
      void getMiniWindowAlwaysOnTop(context.sessionId).then(setIsAlwaysOnTop)
    })
  }, [])

  const leaveMiniWindowMode = useCallback((): void => {
    if (!playback) return
    void exitMiniWindowMode({ sessionId: playback.sessionId, currentTime: currentTimeRef.current })
  }, [playback])

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

  const resize = (event: React.PointerEvent<HTMLDivElement>): void => {
    const gesture = resizeGestureRef.current
    if (!playback || !gesture || gesture.pointerId !== event.pointerId) return

    const horizontalChange = isLeftCorner(gesture.corner)
      ? gesture.pointerX - event.screenX
      : event.screenX - gesture.pointerX
    const verticalChange = isTopCorner(gesture.corner)
      ? (gesture.pointerY - event.screenY) * MINI_WINDOW_ASPECT_RATIO
      : (event.screenY - gesture.pointerY) * MINI_WINDOW_ASPECT_RATIO
    const width = clamp(
      Math.round(
        gesture.bounds.width +
          (Math.abs(horizontalChange) >= Math.abs(verticalChange) ? horizontalChange : verticalChange),
      ),
      MINI_WINDOW_MIN_WIDTH,
      MINI_WINDOW_MAX_WIDTH,
    )
    const height = Math.round(width / MINI_WINDOW_ASPECT_RATIO)
    const bounds = getResizedBounds(gesture.corner, gesture.bounds, width, height)

    void resizeMiniWindow({ sessionId: playback.sessionId, corner: gesture.corner, bounds })
  }

  const stopResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    const gesture = resizeGestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    resizeGestureRef.current = undefined
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }

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

  const stopMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const gesture = moveGestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    moveGestureRef.current = undefined
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') leaveMiniWindowMode()
      if (
        !playback ||
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

  if (!playback) {
    return <main className="fixed inset-0 bg-black" />
  }

  return (
    <main
      className="fixed inset-0 overflow-hidden bg-black"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <BasicPlayer
        autoPlay
        audioTrackUrl={playback.audioTrackUrl}
        className="h-full"
        enableAutoNext={false}
        initialTime={playback.initialTime}
        loop={playback.loop}
        miniWindowMode
        persistPlaybackSettings={false}
        sourceType={playback.sourceType}
        src={playback.src}
        title={playback.title}
        variant={playback.variant}
        onMiniWindowControllerReady={(controller) => {
          playerControllerRef.current = controller
        }}
        onMiniWindowPlayerStateChange={setPlayerState}
        onProgress={({ currentTime }) => {
          currentTimeRef.current = currentTime
          if (lastReportedTimeRef.current === currentTime) return
          lastReportedTimeRef.current = currentTime
          void updateMiniWindowPlayback({ sessionId: playback.sessionId, currentTime })
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 z-10 cursor-grab [-webkit-app-region:no-drag] active:cursor-grabbing"
        onLostPointerCapture={stopMove}
        onPointerCancel={stopMove}
        onPointerDown={startMove}
        onPointerMove={move}
        onPointerUp={stopMove}
      />
      <div
        className={`absolute top-[clamp(12px,3vw,16px)] right-[clamp(12px,3vw,16px)] z-30 flex gap-[clamp(4px,1.5vw,8px)] transition-opacity duration-150 [-webkit-app-region:no-drag] ${
          isHovering ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
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
        <MiniWindowActionButton
          label={playerState.isMuted ? '恢复声音' : '静音'}
          onClick={() => playerControllerRef.current?.toggleMuted()}
        >
          {playerState.isMuted ? <VolumeX /> : <Volume2 />}
        </MiniWindowActionButton>
        <MiniWindowActionButton label="退出小窗模式" onClick={leaveMiniWindowMode}>
          <LogOut />
        </MiniWindowActionButton>
      </div>
      <button
        type="button"
        aria-label={playerState.isPlaying ? '暂停播放' : '继续播放'}
        className={`absolute top-1/2 left-1/2 z-30 flex size-[clamp(36px,14vw,56px)] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[clamp(10px,4vw,18px)] bg-black/45 text-white transition-[opacity,background-color] duration-150 [-webkit-app-region:no-drag] hover:bg-black/65 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none ${
          isHovering ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={() => playerControllerRef.current?.togglePlayback()}
      >
        {playerState.isPlaying ? (
          <Pause className="size-[clamp(18px,7vw,26px)]" aria-hidden="true" />
        ) : (
          <Play className="size-[clamp(18px,7vw,26px)]" aria-hidden="true" />
        )}
      </button>
      {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((corner) => (
        <div
          key={corner}
          aria-hidden="true"
          className={getResizeHandleClassName(corner)}
          onLostPointerCapture={stopResize}
          onPointerCancel={stopResize}
          onPointerDown={(event) => startResize(corner, event)}
          onPointerMove={resize}
          onPointerUp={stopResize}
        />
      ))}
    </main>
  )
}

interface MiniWindowActionButtonProps {
  disabled?: boolean
  label: string
  children: React.ReactNode
  onClick: () => void
}

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
      className="flex size-[clamp(24px,8vw,34px)] items-center justify-center rounded-[clamp(7px,2.5vw,12px)] bg-black/45 text-white transition-colors hover:bg-black/65 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none disabled:cursor-wait disabled:opacity-55 [&_svg]:size-[clamp(13px,4vw,18px)]"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function isLeftCorner(corner: MiniWindowResizeCorner): boolean {
  return corner === 'top-left' || corner === 'bottom-left'
}

function isTopCorner(corner: MiniWindowResizeCorner): boolean {
  return corner === 'top-left' || corner === 'top-right'
}

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

function getResizeHandleClassName(corner: MiniWindowResizeCorner): string {
  const positions: Record<MiniWindowResizeCorner, string> = {
    'top-left': 'top-0 left-0 cursor-nwse-resize',
    'top-right': 'top-0 right-0 cursor-nesw-resize',
    'bottom-left': 'bottom-0 left-0 cursor-nesw-resize',
    'bottom-right': 'right-0 bottom-0 cursor-nwse-resize',
  }
  return `absolute z-30 size-3 [-webkit-app-region:no-drag] ${positions[corner]}`
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}
