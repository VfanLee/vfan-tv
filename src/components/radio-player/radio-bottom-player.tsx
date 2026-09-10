import { isDesktopRuntime } from '@/platform/tauri'
import { useEffect, useRef, useState } from 'react'
import { AudioLines, LoaderCircle, PictureInPicture2, Play, Radio, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { toast } from 'sonner'
import { enterMiniWindowMode, isApiAvailable, onMiniWindowModeExit } from '@/platform/api'
import { useRadioPlayerStore } from '@/stores'
import { cn } from '@/utils'
import { RadioBackground, RadioStationCover } from './radio-player-visuals'

/** 渲染电台底部播放控制栏 */
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

        {isDesktopRuntime() || isApiAvailable() ? (
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
