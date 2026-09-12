import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Popover } from 'radix-ui'
import type { IptvChannelStream } from '@/types'
import { cn } from '@/utils'

interface PlaybackRouteSelectorProps {
  streams: IptvChannelStream[]
  currentStreamId?: string
  firstFrameMs?: number
  failedStreamIds: ReadonlySet<string>
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectStream: (streamId: string) => void
}

/** 在播放器内部展示线路选择浮层与当前连接状态 */
export function PlaybackRouteSelector({
  streams,
  currentStreamId,
  firstFrameMs,
  failedStreamIds,
  open,
  onOpenChange,
  onSelectStream,
}: PlaybackRouteSelectorProps): React.JSX.Element {
  const titleId = useId()
  const currentButtonRef = useRef<HTMLButtonElement>(null)
  const [playerBoundary, setPlayerBoundary] = useState<Element | null>(null)
  const [content, setContent] = useState<HTMLDivElement | null>(null)
  const currentIndex = streams.findIndex((stream) => stream.id === currentStreamId)

  /** 将浮层避让范围限制在当前播放器内 */
  const bindTrigger = useCallback((element: HTMLButtonElement | null): void => {
    setPlayerBoundary(element?.closest('.art-video-player') ?? null)
  }, [])

  /** 在浮层完成尺寸调整后将聚焦的当前线路滚动到可见区域 */
  useEffect(() => {
    if (!content) return
    const observer = new ResizeObserver(() => {
      const button = currentButtonRef.current
      if (button === document.activeElement) button?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [content])

  if (streams.length <= 1) return <span>{streams.length === 1 ? '单线路' : '暂无线路'}</span>

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        ref={bindTrigger}
        type="button"
        aria-label={
          currentIndex < 0
            ? `选择播放线路，共 ${streams.length} 条`
            : `切换播放线路，当前第 ${currentIndex + 1} 条，共 ${streams.length} 条`
        }
        className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-white/85 transition-colors hover:bg-white/6 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none data-[state=open]:bg-white/10 motion-reduce:transition-none"
        onKeyDown={(event) => event.stopPropagation()}
      >
        <span>
          线路 {currentIndex < 0 ? '—' : currentIndex + 1} / {streams.length}
        </span>
        <ChevronDown aria-hidden className={cn('size-3.5 shrink-0', open && 'rotate-180')} />
      </Popover.Trigger>
      <Popover.Content
        ref={setContent}
        align="end"
        side="bottom"
        sideOffset={8}
        collisionBoundary={playerBoundary}
        collisionPadding={12}
        sticky="always"
        aria-labelledby={titleId}
        data-player-overlay
        className="z-50 flex max-h-[min(22rem,var(--radix-popover-content-available-height))] w-[280px] max-w-[var(--radix-popover-content-available-width)] flex-col overflow-hidden rounded-xl border border-white/12 bg-[#09090B]/96 p-1.5 text-white shadow-2xl outline-none"
        onKeyDown={(event) => event.stopPropagation()}
        onOpenAutoFocus={(event) => {
          if (!currentButtonRef.current) return
          event.preventDefault()
          currentButtonRef.current.focus({ preventScroll: true })
        }}
      >
        <div className="flex shrink-0 items-center justify-between px-2.5 pt-1.5 pb-2 text-xs font-medium text-white/55">
          <h3 id={titleId}>播放线路</h3>
          <span>共 {streams.length} 条</span>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-0.5">
          {streams.map((stream) => {
            const isCurrent = stream.id === currentStreamId
            const failed = failedStreamIds.has(stream.id)
            /** 优先显示失败结果，首帧到达前不标记为正在播放 */
            const status = failed
              ? isCurrent
                ? '播放失败'
                : '上次失败'
              : isCurrent
                ? firstFrameMs === undefined
                  ? '连接中'
                  : '正在播放'
                : undefined

            return (
              <button
                key={stream.id}
                ref={isCurrent ? currentButtonRef : undefined}
                type="button"
                aria-current={isCurrent ? 'true' : undefined}
                title={stream.name}
                className={cn(
                  'flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none motion-reduce:transition-none',
                  isCurrent ? 'bg-white/10' : 'hover:bg-white/6',
                )}
                onClick={() => {
                  if (!isCurrent) onSelectStream(stream.id)
                  onOpenChange(false)
                }}
              >
                <span aria-hidden className="size-4 shrink-0">
                  {isCurrent ? <Check className="size-4" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{stream.name}</span>
                {status ? (
                  <span className={cn('shrink-0 text-xs font-normal', failed ? 'text-[#FCD34D]' : 'text-white/55')}>
                    {status}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </Popover.Content>
    </Popover.Root>
  )
}
