import { AlertTriangle, Check, Radio } from 'lucide-react'
import type { IptvChannel, IptvChannelStream } from '@shared/types'
import type { PlayerRuntimeInfo } from '@renderer/components'
import { cn } from '@/utils'
import { IptvChannelLogo } from './iptv-channel-logo'

interface PlaybackInfoOverlayProps {
  sourceId: string
  channel: IptvChannel
  currentStream?: IptvChannelStream
  runtimeInfo: PlayerRuntimeInfo
  failedStreamIds: ReadonlySet<string>
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectStream: (streamId: string) => void
}

/** 渲染播放信息浮层 */
export function PlaybackInfoOverlay({
  sourceId,
  channel,
  currentStream,
  runtimeInfo,
  failedStreamIds,
  open,
  onOpenChange,
  onSelectStream,
}: PlaybackInfoOverlayProps): React.JSX.Element {
  const currentStreamIndex = Math.max(
    0,
    channel.streams.findIndex((stream) => stream.id === currentStream?.id),
  )
  return (
    <div className="absolute top-5 right-5 w-[min(44rem,calc(100%-2.5rem))] text-white" data-player-overlay>
      <button
        type="button"
        aria-expanded={open}
        aria-label="查看播放信息和线路"
        className="w-full rounded-[1.25rem] border border-white/12 bg-zinc-950/80 px-6 py-5 text-left shadow-2xl backdrop-blur-xl transition-colors hover:bg-zinc-950/88 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none sm:px-7 sm:py-6"
        onClick={() => onOpenChange(!open)}
      >
        <div className="flex items-center gap-5 sm:gap-7">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-2xl leading-tight font-bold tracking-tight sm:text-3xl">{channel.title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-white/68 sm:text-base">
              <span>{formatVideoSummary(runtimeInfo)}</span>
              <span>{formatAudioLayout(runtimeInfo.audioChannels)}</span>
              <span>
                {currentStreamIndex + 1}/{channel.streams.length} 线路
              </span>
              <span>{formatBitrate(runtimeInfo.videoBitrate)}</span>
            </div>
            <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-5 text-base font-semibold sm:text-lg">
              <span className="text-white/70">正在播放</span>
              <span className="truncate text-white/90">精彩节目</span>
            </div>
          </div>
          <IptvChannelLogo
            className="size-24 bg-white/8 text-white/45 sm:size-28"
            imageClassName="p-1"
            sourceId={sourceId}
            src={channel.logo}
          />
        </div>
      </button>

      {open ? (
        <div className="mt-2 max-h-[min(44vh,22rem)] overflow-y-auto rounded-2xl border border-white/12 bg-zinc-950/92 p-2 shadow-2xl backdrop-blur-xl">
          <div className="px-3 pt-2 pb-1 text-xs font-medium tracking-wide text-white/45">播放线路</div>
          {channel.streams.map((stream) => {
            const isCurrent = stream.id === currentStream?.id
            const failed = failedStreamIds.has(stream.id) && !isCurrent
            return (
              <button
                key={stream.id}
                type="button"
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none',
                  isCurrent ? 'bg-white text-zinc-950' : 'hover:bg-white/10',
                )}
                onClick={() => onSelectStream(stream.id)}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-current/10">
                  {failed ? (
                    <AlertTriangle className="size-4 text-amber-400" />
                  ) : isCurrent ? (
                    <Check className="size-4" />
                  ) : (
                    <Radio className="size-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{stream.name}</span>
                <span
                  className={cn(
                    'shrink-0 text-xs',
                    isCurrent ? 'text-zinc-600' : failed ? 'text-amber-300' : 'text-white/45',
                  )}
                >
                  {isCurrent ? '正在播放' : failed ? '尝试失败' : '可切换'}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

/** 将数值格式化为整数或一位小数 */
function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/** 将画面尺寸、帧率和动态范围组合为紧凑摘要 */
function formatVideoSummary(runtimeInfo: PlayerRuntimeInfo): string {
  const values = [
    runtimeInfo.width && runtimeInfo.height ? `${runtimeInfo.width}×${runtimeInfo.height}` : undefined,
    runtimeInfo.fps ? `${formatNumber(runtimeInfo.fps)} FPS` : undefined,
    runtimeInfo.dynamicRange,
  ].filter((value): value is string => Boolean(value))
  return values.join('·') || '画面信息加载中'
}

/** 将音频声道格式化为用户易读的布局名称 */
function formatAudioLayout(value?: string): string {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return '音频 —'
  if (normalized === '1' || normalized === 'mono') return '单声道'
  if (normalized === '2' || normalized === 'stereo') return '立体声'
  return `${value} 声道`
}

/** 将每秒比特数格式化为紧凑码率 */
function formatBitrate(value?: number): string {
  if (!value) return '码率 —'
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}M` : `${(value / 1_000).toFixed(2)}K`
}
