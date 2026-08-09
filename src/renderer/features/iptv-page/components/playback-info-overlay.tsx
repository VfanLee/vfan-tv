import { AlertTriangle, Check, ChevronDown, Radio } from 'lucide-react'
import type { IptvChannel, IptvChannelPrograms, IptvChannelStream } from '@shared/types'
import type { PlayerRuntimeInfo } from '@renderer/components'
import { cn } from '@/utils'
import { IptvChannelLogo } from './iptv-channel-logo'

interface PlaybackInfoOverlayProps {
  sourceId: string
  channel: IptvChannel
  currentStream?: IptvChannelStream
  runtimeInfo: PlayerRuntimeInfo
  programs?: IptvChannelPrograms
  failedStreamIds: ReadonlySet<string>
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectStream: (streamId: string) => void
}

export function PlaybackInfoOverlay({
  sourceId,
  channel,
  currentStream,
  runtimeInfo,
  programs,
  failedStreamIds,
  open,
  onOpenChange,
  onSelectStream,
}: PlaybackInfoOverlayProps): React.JSX.Element {
  return (
    <div className="absolute top-5 right-5 w-[min(28rem,calc(100%-2.5rem))] text-white" data-player-overlay>
      <button
        type="button"
        aria-expanded={open}
        aria-label="查看播放信息和线路"
        className="w-full rounded-2xl border border-white/12 bg-zinc-950/80 p-4 text-left shadow-2xl backdrop-blur-xl transition-colors hover:bg-zinc-950/90 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
        onClick={() => onOpenChange(!open)}
      >
        <div className="flex items-start gap-3">
          <IptvChannelLogo
            className="size-11 rounded-xl bg-white/8 text-white/45"
            imageClassName="p-1"
            sourceId={sourceId}
            src={channel.logo}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-base font-semibold sm:text-lg">{channel.title}</h2>
                <p className="mt-0.5 truncate text-xs text-white/55">
                  {currentStream?.name ?? '线路 —'} · {channel.streams.length} 条线路
                </p>
              </div>
              <ChevronDown
                className={cn('mt-1 size-4 shrink-0 text-white/60 transition-transform', open && 'rotate-180')}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-white/70 sm:grid-cols-4">
              <InfoValue label="首帧" value={runtimeInfo.firstFrameMs ? `${runtimeInfo.firstFrameMs} ms` : '—'} />
              <InfoValue
                label="画面"
                value={runtimeInfo.width && runtimeInfo.height ? `${runtimeInfo.width}×${runtimeInfo.height}` : '—'}
              />
              <InfoValue label="帧率" value={runtimeInfo.fps ? `${formatNumber(runtimeInfo.fps)} FPS` : '—'} />
              <InfoValue
                label="编码"
                value={[runtimeInfo.videoCodec, runtimeInfo.audioCodec].filter(Boolean).join(' / ') || '—'}
              />
              <InfoValue label="动态范围" value={runtimeInfo.dynamicRange ?? '—'} />
              <InfoValue label="视频码率" value={formatBitrate(runtimeInfo.videoBitrate)} />
              <InfoValue
                label="音频"
                value={
                  [
                    runtimeInfo.audioChannels ? `${runtimeInfo.audioChannels} 声道` : undefined,
                    runtimeInfo.audioSampleRate ? `${(runtimeInfo.audioSampleRate / 1_000).toFixed(1)} kHz` : undefined,
                  ]
                    .filter(Boolean)
                    .join(' / ') || '—'
                }
              />
              <InfoValue
                label="解码"
                value={
                  runtimeInfo.decoder
                    ? `${runtimeInfo.decoder}${runtimeInfo.hardwareDecoding ? '（硬件）' : '（软件）'}`
                    : '—'
                }
              />
            </div>
          </div>
        </div>
        <div className="mt-3 border-t border-white/10 pt-3 text-xs">
          <ProgramRow label="正在播放" title={programs?.current?.title} />
          <ProgramRow label="接下来" title={programs?.next?.title} muted />
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

function InfoValue({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <span className="min-w-0 truncate">
      <span className="text-white/40">{label}</span> {value}
    </span>
  )
}

function ProgramRow({
  label,
  title,
  muted = false,
}: {
  label: string
  title?: string
  muted?: boolean
}): React.JSX.Element {
  return (
    <div className={cn('mt-1 flex min-w-0 gap-3 first:mt-0', muted && 'text-white/55')}>
      <span className="w-14 shrink-0 text-white/40">{label}</span>
      <span className="truncate">{title ?? '—'}</span>
    </div>
  )
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function formatBitrate(value?: number): string {
  if (!value) return '—'
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)} Mbps` : `${(value / 1_000).toFixed(0)} Kbps`
}
