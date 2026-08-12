import { useState } from 'react'
import { FileText, FolderOpen, Trash2 } from 'lucide-react'
import { ConfirmDialog, SettingsSection } from '@renderer/components'
import { Button } from '@/ui/button'
import { useDiagnostics } from '../hooks/use-diagnostics'

/** 渲染诊断日志状态与管理操作 */
export function DiagnosticsSettingsCard({ apiAvailable }: { apiAvailable: boolean }): React.JSX.Element {
  const diagnostics = useDiagnostics(apiAvailable)
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false)
  const isUnavailable = !apiAvailable || diagnostics.isLoading || !diagnostics.info

  return (
    <SettingsSection
      className="mt-10"
      description="主进程网络请求和运行异常会写入本地日志，便于定位服务端问题。"
      title="诊断日志"
    >
      <div className="border-border divide-border divide-y border-y">
        <div className="flex flex-wrap items-start gap-4 py-5">
          <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-full">
            <FileText size={18} />
          </div>
          <div className="min-w-52 flex-1">
            <h3 className="text-sm font-semibold">主进程日志</h3>
            <p className="text-muted-foreground mt-1 text-sm leading-6">
              {diagnostics.isLoading
                ? '正在读取日志状态…'
                : diagnostics.info
                  ? `当前文件 ${formatBytes(diagnostics.info.fileSizeBytes)}，共占用 ${formatBytes(diagnostics.info.totalSizeBytes)} / ${formatBytes(diagnostics.info.maxTotalSizeBytes)}`
                  : '当前运行环境无法读取日志状态。'}
            </p>
            {diagnostics.info ? (
              <>
                <p className="text-muted-foreground mt-1 text-xs leading-5">
                  单文件最多 {formatBytes(diagnostics.info.maxFileSizeBytes)}，自动保留当前日志和一个历史文件。
                </p>
                <p className="text-muted-foreground mt-2 font-mono text-xs leading-5 break-all select-text">
                  {diagnostics.info.filePath}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  最近写入：{formatUpdatedAt(diagnostics.info.updatedAt)}
                </p>
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={isUnavailable || diagnostics.isClearing}
              variant="outline"
              onClick={() => void diagnostics.reveal()}
            >
              <FolderOpen data-icon="inline-start" />
              打开日志目录
            </Button>
            <Button
              disabled={isUnavailable || diagnostics.isClearing || diagnostics.info?.totalSizeBytes === 0}
              variant="destructive"
              onClick={() => setIsClearConfirmOpen(true)}
            >
              <Trash2 data-icon="inline-start" />
              {diagnostics.isClearing ? '清空中' : '清空日志'}
            </Button>
          </div>
        </div>
      </div>

      {isClearConfirmOpen ? (
        <ConfirmDialog
          confirmText="清空日志"
          description="当前日志和历史日志都会被清空，此操作无法撤销。应用无需重启，之后产生的新日志仍会继续写入。"
          title="确认清空诊断日志？"
          onCancel={() => setIsClearConfirmOpen(false)}
          onConfirm={async () => {
            if (await diagnostics.clear()) setIsClearConfirmOpen(false)
          }}
        />
      ) : null}
    </SettingsSection>
  )
}

/** 将字节数格式化为便于阅读的容量 */
function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

/** 格式化日志最近写入时间 */
function formatUpdatedAt(value: number | undefined): string {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '暂无日志'
}
