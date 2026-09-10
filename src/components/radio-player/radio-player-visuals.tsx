import { useEffect, useState } from 'react'
import { AudioLines, LoaderCircle, Pause, Play, Radio } from 'lucide-react'
import type { RadioChannel } from '@/types'
import { getSourceImageUrl } from '@/platform/api'
import radioPlayerBackgroundUrl from '@/assets/radio-player-background.png'
import radioPlayerBackgroundDarkUrl from '@/assets/radio-player-background-dark.png'
import { cn } from '@/utils'

/** 根据播放状态显示控制图标 */
export function RadioPlaybackControlIcon({
  className,
  size = 'compact',
  state,
}: {
  className?: string
  size?: 'compact' | 'default'
  state: 'loading' | 'pause' | 'play' | 'playing'
}): React.JSX.Element {
  const iconSize = size === 'default' ? 24 : 16

  return (
    <span
      aria-hidden="true"
      className={cn(
        'bg-primary text-primary-foreground group-hover/playback:bg-primary/90 flex shrink-0 items-center justify-center rounded-full shadow-sm transition-all group-active/playback:scale-95',
        size === 'default' ? 'size-14' : 'size-10',
        className,
      )}
    >
      {state === 'loading' ? (
        <LoaderCircle className="animate-spin motion-reduce:animate-none" size={iconSize} />
      ) : state === 'pause' ? (
        <Pause size={iconSize} fill="currentColor" />
      ) : state === 'playing' ? (
        <RadioSignal active compact inverted />
      ) : (
        <Play className="ml-0.5" size={iconSize} fill="currentColor" />
      )}
    </span>
  )
}

/** 渲染电台播放器背景 */
export function RadioBackground(): React.JSX.Element {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-cover bg-center dark:hidden"
        style={{ backgroundImage: `url(${radioPlayerBackgroundUrl})` }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 hidden bg-cover bg-center dark:block"
        style={{ backgroundImage: `url(${radioPlayerBackgroundDarkUrl})` }}
      />
    </>
  )
}

/** 渲染电台封面和加载占位 */
export function RadioStationCover({
  channel,
  className,
}: {
  channel: RadioChannel
  className: string
}): React.JSX.Element {
  const [resolvedCover, setResolvedCover] = useState<{ key: string; url?: string }>()
  const coverUrl = resolvedCover && resolvedCover.key === channel.coverUrl ? resolvedCover.url : undefined
  /** 解析并更新电台封面地址 */
  useEffect(() => {
    let active = true
    if (channel.coverUrl) {
      void getSourceImageUrl(undefined, channel.coverUrl, undefined, 'radio').then((url) => {
        if (active) setResolvedCover({ key: channel.coverUrl ?? '', url })
      })
    }
    return () => {
      active = false
    }
  }, [channel.coverUrl])
  if (coverUrl) {
    return <img alt="" className={cn('bg-muted object-cover', className)} draggable={false} src={coverUrl} />
  }
  return (
    <span
      aria-label={channel.title}
      className={cn('bg-primary/10 text-primary flex items-center justify-center', className)}
    >
      <Radio size={22} />
    </span>
  )
}

/** 显示电台播放信号状态 */
export function RadioSignal({
  active,
  compact = false,
  inverted = false,
}: {
  active: boolean
  compact?: boolean
  inverted?: boolean
}): React.JSX.Element {
  return (
    <AudioLines
      aria-hidden="true"
      className={cn(
        'text-muted-foreground transition-colors',
        compact ? 'size-4' : 'size-7',
        active && (inverted ? 'text-current' : 'text-primary'),
        active && 'animate-pulse motion-reduce:animate-none',
      )}
    />
  )
}
