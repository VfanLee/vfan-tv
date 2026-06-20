import { useState } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/Button'
import type { PlayerErrorLog } from './types'

export function PlayerErrorLogDialog({
  logs,
  onClose,
}: {
  logs: PlayerErrorLog[]
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/45 px-4" onClick={onClose}>
      <div
        aria-labelledby="player-error-log-title"
        aria-modal="true"
        className="border-border bg-card flex max-h-[70vh] w-full max-w-2xl flex-col rounded-xl border p-4 shadow-lg"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-foreground text-sm font-semibold" id="player-error-log-title">
              当前播放错误日志
            </h2>
            <p className="text-muted-foreground mt-1 text-xs">切换剧集或播放地址后自动清空。</p>
          </div>
          <DialogCloseButton label="关闭错误日志" onClick={onClose} />
        </div>

        {logs.length > 0 ? (
          <div className="border-border mt-4 min-h-0 flex-1 overflow-y-auto rounded-xl border">
            {[...logs].reverse().map((log) => (
              <div key={log.id} className="border-border border-b px-3 py-3 last:border-b-0">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                  <span className={log.fatal ? 'text-destructive' : 'text-muted-foreground'}>
                    {log.fatal ? '严重' : '可恢复'}
                  </span>
                  <span className="text-foreground">{log.source}</span>
                  <time className="text-muted-foreground ml-auto">{formatLogTime(log.timestamp)}</time>
                </div>
                <p className="text-muted-foreground mt-2 font-mono text-xs leading-5 break-words">{log.message}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="border-input text-muted-foreground mt-4 flex h-36 items-center justify-center rounded-xl border border-dashed text-sm">
            当前播放尚未产生错误日志
          </div>
        )}
      </div>
    </div>
  )
}

export function PlaySourceDialog({ onClose, src }: { onClose: () => void; src: string }): React.JSX.Element {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const copyUrl = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(src)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }

    window.setTimeout(() => setCopyState('idle'), 2000)
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/45 px-4" onClick={onClose}>
      <div
        aria-labelledby="play-source-title"
        aria-modal="true"
        className="border-border bg-card w-full max-w-xl rounded-xl border p-4 shadow-lg"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-foreground text-sm font-semibold" id="play-source-title">
            播放地址
          </h2>
          <DialogCloseButton label="关闭播放地址" onClick={onClose} />
        </div>

        <p className="bg-muted text-foreground border-border mt-3 rounded-xl border px-3 py-2 font-mono text-xs leading-5 break-all">
          {src}
        </p>

        <div className="mt-3 flex justify-end">
          <Button className="h-8 px-3 text-xs" type="button" variant="primary" onClick={() => void copyUrl()}>
            {copyState === 'copied' ? <Check size={14} /> : <Copy size={14} />}
            {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function DialogCloseButton({ label, onClick }: { label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button
      aria-label={label}
      className="text-muted-foreground hover:text-foreground inline-flex size-7 items-center justify-center rounded-xl transition-colors"
      type="button"
      onClick={onClick}
    >
      <X size={15} />
    </button>
  )
}

function formatLogTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp)
}
