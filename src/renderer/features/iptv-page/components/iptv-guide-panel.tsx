import { AlertTriangle, CalendarDays } from 'lucide-react'
import type { IptvChannel, IptvChannelStream, IptvEpgProgram } from '@shared/types'
import type { PlayerRuntimeInfo } from '@renderer/components'
import { Button } from '@/ui/button'
import { cn } from '@/utils'
import { IptvChannelLogo } from './iptv-channel-logo'

interface IptvGuidePanelProps {
  sourceId: string
  channel: IptvChannel
  currentStream?: IptvChannelStream
  runtimeInfo: PlayerRuntimeInfo
  programs: IptvEpgProgram[]
  failedStreamIds: ReadonlySet<string>
  now: number
  onSelectStream: (streamId: string) => void
  onOpenSchedule: () => void
}

export function IptvGuidePanel({
  sourceId,
  channel,
  currentStream,
  runtimeInfo,
  programs,
  failedStreamIds,
  now,
  onSelectStream,
  onOpenSchedule,
}: IptvGuidePanelProps): React.JSX.Element {
  const visiblePrograms = selectVisiblePrograms(programs, now)

  return (
    <section className="border-border bg-background flex h-[clamp(230px,28vh,300px)] shrink-0 flex-col border-t">
      <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3.5 lg:px-7">
        <IptvChannelLogo className="size-12 rounded-xl" imageClassName="p-1.5" sourceId={sourceId} src={channel.logo} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold sm:text-lg">{channel.title}</h1>
          <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs sm:text-sm">
            <span>
              {currentStream?.name ?? '线路 —'} / {channel.streams.length}
            </span>
            <span aria-hidden="true">·</span>
            <span>{formatResolution(runtimeInfo)}</span>
            <span aria-hidden="true">·</span>
            <span>{runtimeInfo.fps ? `${formatNumber(runtimeInfo.fps)} FPS` : '— FPS'}</span>
            <span aria-hidden="true">·</span>
            <span>{[runtimeInfo.videoCodec, runtimeInfo.audioCodec].filter(Boolean).join(' / ') || '编码识别中'}</span>
            <span
              className={cn(
                'ml-1 font-medium tabular-nums',
                runtimeInfo.firstFrameMs ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
              )}
            >
              {runtimeInfo.firstFrameMs ? `${runtimeInfo.firstFrameMs} ms` : '— ms'}
            </span>
          </p>
        </div>
        <div className="border-border bg-muted/30 flex max-w-full overflow-x-auto rounded-xl border p-0.5">
          {channel.streams.map((stream) => {
            const selected = stream.id === currentStream?.id
            const failed = failedStreamIds.has(stream.id) && !selected
            return (
              <button
                key={stream.id}
                type="button"
                className={cn(
                  'focus-visible:ring-ring flex h-10 min-w-24 shrink-0 items-center justify-center gap-1.5 rounded-[10px] px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-2',
                  selected
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : failed
                      ? 'text-destructive hover:bg-destructive/8'
                      : 'text-foreground hover:bg-background',
                )}
                onClick={() => onSelectStream(stream.id)}
              >
                {failed ? <AlertTriangle className="size-3.5" /> : null}
                <span>{stream.name}</span>
                {failed ? <span className="text-[11px]">失败</span> : null}
              </button>
            )
          })}
        </div>
      </div>

      <div className="border-border min-h-0 flex-1 border-t">
        {visiblePrograms.length ? (
          <div className="flex h-full min-w-0 overflow-x-auto">
            {visiblePrograms.map((program) => (
              <GuideProgram key={program.id} now={now} program={program} />
            ))}
          </div>
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
            <CalendarDays className="size-4" />
            暂无今日节目单
          </div>
        )}
      </div>

      <div className="border-border flex shrink-0 justify-end border-t px-5 py-2 lg:px-7">
        <Button size="sm" variant="outline" onClick={onOpenSchedule}>
          <CalendarDays className="size-4" />
          查看节目单
        </Button>
      </div>
    </section>
  )
}

function GuideProgram({ program, now }: { program: IptvEpgProgram; now: number }): React.JSX.Element {
  const status = program.endAt <= now ? 'played' : program.startAt <= now ? 'current' : 'upcoming'
  const progress =
    status === 'current'
      ? Math.max(0, Math.min(100, ((now - program.startAt) / (program.endAt - program.startAt)) * 100))
      : status === 'played'
        ? 100
        : 0
  return (
    <div
      className={cn(
        'border-border relative flex min-w-[210px] flex-1 flex-col justify-center border-r px-5 py-3 last:border-r-0 lg:px-7',
        status === 'current' && 'bg-primary/7',
      )}
    >
      <time
        className={cn(
          'text-xs font-medium tabular-nums',
          status === 'current' ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        {formatTime(program.startAt)}
      </time>
      <div className="mt-1 truncate text-sm font-semibold">{program.title}</div>
      <div className="text-muted-foreground mt-1 text-xs">
        {formatTime(program.startAt)}–{formatTime(program.endAt)}
        {status === 'current' ? ' · 正在播放' : status === 'played' ? ' · 已播放' : ''}
      </div>
      {status === 'current' ? (
        <span
          className="bg-primary absolute right-0 bottom-0 left-0 h-1 origin-left"
          style={{ transform: `scaleX(${progress / 100})` }}
        />
      ) : null}
    </div>
  )
}

function selectVisiblePrograms(programs: IptvEpgProgram[], now: number): IptvEpgProgram[] {
  if (programs.length <= 4) return programs
  const currentIndex = programs.findIndex((program) => program.startAt <= now && program.endAt > now)
  const nextIndex = programs.findIndex((program) => program.startAt > now)
  const anchor = currentIndex >= 0 ? currentIndex : nextIndex >= 0 ? nextIndex : programs.length - 1
  const start = Math.max(0, Math.min(programs.length - 4, anchor - 1))
  return programs.slice(start, start + 4)
}

function formatResolution(info: PlayerRuntimeInfo): string {
  return info.width && info.height ? `${info.width}×${info.height}` : '分辨率识别中'
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(value)
}
