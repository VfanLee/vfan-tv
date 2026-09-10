import { useEffect, useState } from 'react'
import { EyeOff, LogOut, Pin, PinOff, RotateCcw } from 'lucide-react'
import type { RadioMiniWindowPlaybackContext, RadioMiniWindowPlaybackExit } from '@/types'
import { RadioPlaybackControlIcon, RadioStreamEngine, useRadioProgramRefresh } from '@/components'
import { updateMiniWindowPlayback } from '@/platform/api'
import type { RadioPlaybackCommand, RadioPlaybackStatus } from '@/stores/radio-player'
import { type MiniWindowActionButtonProps } from './mini-window-action-button'

/** 渲染电台迷你窗口播放器 */
export function RadioMiniWindowPlayer({
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
