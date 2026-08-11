import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Loader2, X } from 'lucide-react'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { range } from 'es-toolkit/math'
import type { IptvEpgProgram, IptvProgramScheduleResult } from '@shared/types'
import { getIptvProgramSchedule } from '@renderer/platform/api'
import { cn } from '@/utils'

interface ProgramScheduleOverlayProps {
  sourceId: string
  channelId: string
  channelTitle: string
  open: boolean
  initialResult?: IptvProgramScheduleResult
  onClose: () => void
}

/** 渲染频道节目单浮层 */
export function ProgramScheduleOverlay({
  sourceId,
  channelId,
  channelTitle,
  open,
  initialResult,
  onClose,
}: ProgramScheduleOverlayProps): React.JSX.Element | null {
  const dates = useMemo(() => createScheduleDates(), [])
  const today = dates[3]?.key ?? ''
  const [selectedDate, setSelectedDate] = useState(today)
  const [results, setResults] = useState<Record<string, IptvProgramScheduleResult>>(() =>
    initialResult ? { [initialResult.date]: initialResult } : {},
  )
  const [loadingDate, setLoadingDate] = useState<string | undefined>(() => (initialResult ? undefined : today))
  const [requestError, setRequestError] = useState<string>()
  const [statusNow] = useState(() => Date.now())
  const dialogRef = useRef<HTMLDivElement | null>(null)

  /** 打开节目单时接管焦点和 Escape 关闭操作 */
  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement
    dialogRef.current?.focus()
    /** 处理键盘按键事件 */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (previousFocus instanceof HTMLElement) previousFocus.focus()
    }
  }, [onClose, open])

  /** 加载当前选中日期的频道节目单 */
  useEffect(() => {
    if (!open || !selectedDate || results[selectedDate]) return
    let active = true
    void getIptvProgramSchedule(sourceId, channelId, selectedDate)
      .then((result) => {
        if (active) setResults((current) => ({ ...current, [selectedDate]: result }))
      })
      .catch((error: unknown) => {
        if (active) setRequestError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (active) setLoadingDate((current) => (current === selectedDate ? undefined : current))
      })
    return () => {
      active = false
    }
  }, [channelId, open, results, selectedDate, sourceId])

  if (!open) return null
  const result = results[selectedDate]
  const isLoading = loadingDate === selectedDate

  return (
    <div
      className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/45 p-3 backdrop-blur-sm sm:p-6"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${channelTitle} 节目单`}
        tabIndex={-1}
        className="border-border bg-background text-foreground flex h-[min(82vh,760px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border shadow-2xl outline-none"
      >
        <header className="border-border flex shrink-0 items-center gap-3 border-b px-4 py-3 sm:px-6 sm:py-4">
          <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl">
            <CalendarDays className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate font-semibold">{channelTitle}</h2>
            <p className="text-muted-foreground mt-0.5 text-xs">七日节目单 · 仅供查看</p>
          </div>
          <button
            type="button"
            aria-label="关闭节目单"
            className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring ml-auto flex size-9 items-center justify-center rounded-lg outline-none focus-visible:ring-2"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="border-border bg-muted/25 grid shrink-0 grid-cols-7 gap-1 border-b p-2 sm:gap-2 sm:p-4">
          {dates.map((date) => (
            <button
              key={date.key}
              type="button"
              className={cn(
                'focus-visible:ring-ring rounded-xl px-1 py-2 text-center transition-colors focus-visible:ring-2 focus-visible:outline-none',
                selectedDate === date.key
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-background hover:text-foreground',
              )}
              onClick={() => {
                setSelectedDate(date.key)
                setLoadingDate(results[date.key] ? undefined : date.key)
                setRequestError(undefined)
              }}
            >
              <span className="block text-sm font-semibold">{date.day}</span>
              <span className="mt-0.5 block text-[11px]">{date.isToday ? '今天' : date.weekday}</span>
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-6">
          {isLoading ? (
            <EmptyState icon={<Loader2 className="size-5 animate-spin" />} text="正在加载节目单…" />
          ) : requestError ? (
            <EmptyState icon={<CalendarDays className="size-5" />} text={`节目单加载失败：${requestError}`} />
          ) : result?.programs.length ? (
            <>
              {result.errorMessage ? (
                <div className="mb-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  已回退到 {result.actualSource ?? '可用节目单'}：{result.errorMessage}
                </div>
              ) : null}
              <div className="divide-border divide-y">
                {result.programs.map((program) => (
                  <ProgramItem key={program.id} now={statusNow} program={program} />
                ))}
              </div>
            </>
          ) : (
            <EmptyState
              icon={<CalendarDays className="size-5" />}
              text={result?.errorMessage ? `暂无节目单：${result.errorMessage}` : '这一天暂无节目单'}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/** 渲染节目项 */
function ProgramItem({ program, now }: { program: IptvEpgProgram; now: number }): React.JSX.Element {
  const status = program.endAt <= now ? 'played' : program.startAt <= now ? 'current' : 'upcoming'
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 py-3.5">
      <time
        className={cn(
          'font-mono text-sm font-semibold',
          status === 'current' ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        {formatTime(program.startAt)}
      </time>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{program.title}</div>
        <div className="text-muted-foreground mt-0.5 text-xs">
          时长 {formatDuration(program.endAt - program.startAt)}
        </div>
      </div>
      <span
        className={cn(
          'rounded-lg px-2 py-1 text-xs',
          status === 'current'
            ? 'bg-primary/10 text-primary'
            : status === 'played'
              ? 'text-muted-foreground/65'
              : 'text-muted-foreground',
        )}
      >
        {status === 'current' ? '正在直播' : status === 'played' ? '已播放' : '未播放'}
      </span>
    </div>
  )
}

/** 渲染空状态 */
function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }): React.JSX.Element {
  return (
    <div className="text-muted-foreground flex h-48 flex-col items-center justify-center gap-3 text-center text-sm">
      {icon}
      <p>{text}</p>
    </div>
  )
}

/** 创建包含今天前后三天的节目单日期列表 */
function createScheduleDates(): Array<{ key: string; day: string; weekday: string; isToday: boolean }> {
  const today = dayjs().startOf('day')
  return range(-3, 4).map((offset) => {
    const date = today.add(offset, 'day')
    return {
      key: date.format('YYYY-MM-DD'),
      day: date.format('DD'),
      weekday: date.locale('zh-cn').format('ddd'),
      isToday: offset === 0,
    }
  })
}

/** 将时间戳格式化为 24 小时制时分 */
function formatTime(value: number): string {
  return dayjs(value).format('HH:mm')
}

/** 将毫秒时长格式化为小时和分钟 */
function formatDuration(milliseconds: number): string {
  const minutes = Math.max(1, Math.round(milliseconds / 60_000))
  const hours = Math.floor(minutes / 60)
  const remain = minutes % 60
  return hours ? `${hours} 小时${remain ? ` ${remain} 分钟` : ''}` : `${remain} 分钟`
}
