import { useState } from 'react'
import { EyeOff, LogOut, Pause, Pin, PinOff, Play } from 'lucide-react'
import { hideMiniWindow, updateMiniWindowPlayback } from '@/platform/api'
import { cn } from '@/utils'
import { useMiniWindowGestures } from './hooks/use-mini-window-gestures'
import { useMiniWindowSession } from './hooks/use-mini-window-session'
import { VideoMiniWindowPlayer } from './components/video-mini-window-player'
import { RadioMiniWindowPlayer } from './components/radio-mini-window-player'
import { MiniWindowActionButton } from './components/mini-window-action-button'
import { getResizeHandleClassName } from './utils'

/** 渲染迷你窗口页面 */
export function MiniWindowPage(): React.JSX.Element {
  const [isHovering, setIsHovering] = useState(false)
  const {
    playback,
    currentTimeRef,
    radioExitRef,
    lastReportedTimeRef,
    playerControllerRef,
    playerState,
    setPlayerState,
    isAlwaysOnTop,
    isAlwaysOnTopUpdating,
    leaveMiniWindowMode,
    toggleAlwaysOnTop,
  } = useMiniWindowSession()
  const { startMove, move, stopMove, startResize, resize, stopResize } = useMiniWindowGestures(playback)

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
          onToggleAlwaysOnTop={toggleAlwaysOnTop}
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
            onClick={toggleAlwaysOnTop}
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
              onPointerDown={(event) => startResize(corner, event)}
              onPointerMove={resize}
              onPointerUp={stopResize}
            />
          ))
        : null}
    </main>
  )
}
