import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  Gauge,
  Pencil,
  RefreshCw,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import type { VodSourceConfig } from '@/types'
import { EmptyState, VodSourceBackupSwitcher } from '@/components'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Switch } from '@/ui/switch'
import { TableHead, TableHeader, TableRow } from '@/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { cn } from '@/utils'
import type { VodSourceSpeedState } from '../types'
import { type TableScrollEdges } from '../hooks/use-source-table-scroll'
import { type SpeedSortOrder } from './source-table-types'

/** 渲染可点击复制的源地址 */
export function SourceUrlCell({ name, url }: { name: string; url: string }): React.JSX.Element {
  /** 复制当前源地址并提示结果 */
  const copyUrl = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('URL 已复制', { description: name })
    } catch {
      toast.error('复制失败，请重试')
    }
  }

  return (
    <ActionTooltip label={`点击复制：${url}`}>
      <button
        aria-label={`复制 ${name} 的 URL`}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring block w-full cursor-copy truncate rounded-sm text-left font-mono text-xs transition-colors outline-none focus-visible:ring-2"
        type="button"
        onClick={() => void copyUrl()}
      >
        {url}
      </button>
    </ActionTooltip>
  )
}

/** 渲染备用源单元格 */
export function BackupCell({
  source,
  onSwitchBackup,
}: {
  source: VodSourceConfig
  onSwitchBackup: (source: VodSourceConfig, backupUrl: string) => Promise<void>
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center">
      {source.backups.length > 0 ? (
        <VodSourceBackupSwitcher source={source} onSwitchBackup={onSwitchBackup}>
          <Button className="shrink-0" size="xs" type="button" variant="outline">
            {source.backups.length} 个备用
            <ChevronDown data-icon="inline-end" />
          </Button>
        </VodSourceBackupSwitcher>
      ) : null}
      {source.backups.length === 0 ? <span className="text-muted-foreground text-xs">无</span> : null}
    </div>
  )
}

/** 渲染源表格标题 */
export function SourceTableHeader({
  allSelected,
  scrollEdges,
  showBackups,
  showSpeed,
  speedSortOrder,
  onSpeedSort,
  onToggleAll,
}: {
  allSelected: boolean
  scrollEdges: TableScrollEdges
  showBackups: boolean
  showSpeed: boolean
  speedSortOrder: SpeedSortOrder
  onSpeedSort: () => void
  onToggleAll: () => void
}): React.JSX.Element {
  return (
    <TableHeader className="bg-muted/45 text-muted-foreground">
      <TableRow className="hover:bg-muted/45 border-0 [&>th]:border-b">
        <TableHead className="bg-muted sticky top-0 left-0 z-40 px-2">
          <SelectionCheckbox checked={allSelected} label={allSelected ? '取消全选' : '全选源'} onChange={onToggleAll} />
        </TableHead>
        <TableHead className="bg-muted sticky top-0 left-9 z-40 px-2">状态</TableHead>
        <TableHead
          className={cn(
            'bg-muted sticky top-0 left-[132px] z-40 px-2 transition-shadow',
            scrollEdges.left && 'shadow-[5px_0_8px_-8px_rgba(0,0,0,0.45)]',
          )}
        >
          来源
        </TableHead>
        <TableHead className="bg-muted sticky top-0 z-30 px-3">名称</TableHead>
        <TableHead className="bg-muted sticky top-0 z-30 px-3">URL</TableHead>
        {showBackups ? <TableHead className="bg-muted sticky top-0 z-30 px-2">备用地址</TableHead> : null}
        {showSpeed ? (
          <TableHead className="bg-muted sticky top-0 z-30 px-2">
            <ActionTooltip label={getSpeedSortTitle(speedSortOrder)}>
              <button
                className="hover:text-foreground inline-flex items-center gap-1 rounded-sm outline-none focus-visible:ring-2"
                type="button"
                onClick={onSpeedSort}
              >
                API 延迟
                {speedSortOrder === 'asc' ? <ArrowUpToLine size={15} /> : null}
                {speedSortOrder === 'desc' ? <ArrowDownToLine size={15} /> : null}
              </button>
            </ActionTooltip>
          </TableHead>
        ) : null}
        <TableHead
          className={cn(
            'bg-muted sticky top-0 right-0 z-40 px-2 text-right transition-shadow',
            scrollEdges.right && 'shadow-[-5px_0_8px_-8px_rgba(0,0,0,0.45)]',
          )}
        >
          操作
        </TableHead>
      </TableRow>
    </TableHeader>
  )
}

/** 渲染选择状态复选框 */
export function SelectionCheckbox({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: () => void
}): React.JSX.Element {
  return <Checkbox aria-label={label} checked={checked} onCheckedChange={() => onChange()} />
}

/** 渲染状态单元格 */
export function StatusCell({
  checked,
  onCheckedChange,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <Switch aria-label={checked ? '开启' : '关闭'} checked={checked} onCheckedChange={onCheckedChange} />
      <span className="text-muted-foreground text-xs">{checked ? '开启' : '关闭'}</span>
    </div>
  )
}

/** 渲染来源单元格，有订阅关联即为订阅源 */
export function OriginCell({ subscriptionId }: { subscriptionId?: string }): React.JSX.Element {
  return <Badge>{subscriptionId ? '订阅' : '手动'}</Badge>
}

/** 渲染名称单元格 */
export function NameCell({ name }: { name: string }): React.JSX.Element {
  return <div className="text-foreground min-w-0 truncate text-sm font-medium">{name}</div>
}

/** 渲染速度单元格 */
export function SpeedCell({ result, onTest }: { result?: VodSourceSpeedState; onTest: () => void }): React.JSX.Element {
  const testing = result?.status === 'testing'
  const label =
    !result || result.status === 'idle'
      ? '待测速'
      : result.status === 'testing'
        ? '测速中'
        : result.status === 'success'
          ? `${result.elapsedMs} ms`
          : '不可用'
  const title = result?.status === 'error' ? result.errorMessage : undefined
  const resultClassName =
    result?.status === 'success'
      ? result.elapsedMs <= 800
        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
        : result.elapsedMs <= 2000
          ? 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400'
          : 'bg-orange-500/15 text-orange-700 dark:text-orange-400'
      : result?.status === 'error'
        ? 'bg-destructive/10 text-destructive'
        : 'bg-muted text-muted-foreground'

  return (
    <div className="flex items-center gap-2">
      <ActionTooltip label={title}>
        <Badge className={cn('max-w-20 truncate', resultClassName)} variant="secondary">
          {label}
        </Badge>
      </ActionTooltip>
      <ActionTooltip label={testing ? '测速中' : '测速'}>
        <Button
          aria-label={testing ? '测速中' : '测速'}
          className="h-8 px-2"
          disabled={testing}
          variant="ghost"
          onClick={onTest}
        >
          {testing ? <RefreshCw className="animate-spin" /> : <Gauge />}
        </Button>
      </ActionTooltip>
    </div>
  )
}

/** 渲染操作单元格 */
export function ActionCell({
  disabled,
  isFirst,
  isLast,
  onDelete,
  onEdit,
  onMoveToEdge,
}: {
  disabled: boolean
  isFirst: boolean
  isLast: boolean
  onDelete: () => void
  onEdit: () => void
  onMoveToEdge: (edge: 'start' | 'end') => void
}): React.JSX.Element {
  return (
    <div className="flex justify-end gap-1">
      <ActionTooltip label="置顶">
        <Button
          aria-label="置顶"
          className="size-8 p-0"
          disabled={disabled || isFirst}
          variant="ghost"
          onClick={() => onMoveToEdge('start')}
        >
          <ArrowUpToLine />
        </Button>
      </ActionTooltip>
      <ActionTooltip label="置底">
        <Button
          aria-label="置底"
          className="size-8 p-0"
          disabled={disabled || isLast}
          variant="ghost"
          onClick={() => onMoveToEdge('end')}
        >
          <ArrowDownToLine />
        </Button>
      </ActionTooltip>
      <ActionTooltip label="编辑">
        <Button aria-label="编辑" className="size-8 p-0" variant="ghost" onClick={onEdit}>
          <Pencil />
        </Button>
      </ActionTooltip>
      <ActionTooltip label="删除">
        <Button aria-label="删除" className="size-8 p-0" variant="destructive" onClick={onDelete}>
          <Trash2 />
        </Button>
      </ActionTooltip>
    </div>
  )
}

/** 渲染源列表表格的空状态 */
export function EmptyTableState({ icon, text }: { icon: LucideIcon; text: string }): React.JSX.Element {
  return (
    <div className="px-5 py-6">
      <EmptyState density="compact" description="添加后即可在对应页面使用。" icon={icon} title={text} />
    </div>
  )
}

/** 获取速度排序标题 */
function getSpeedSortTitle(order: SpeedSortOrder): string {
  if (order === 'default') return '按速度从快到慢排序'
  if (order === 'asc') return '按速度从慢到快排序'
  return '恢复默认排序'
}

/** 为紧凑操作补充统一提示 */
export function ActionTooltip({ children, label }: { children: React.JSX.Element; label?: string }): React.JSX.Element {
  if (!label) return children
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
