import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  Download,
  Gauge,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { IptvSourceConfig, VodSourceConfig } from '@shared/types'
import { EmptyState, VodSourceBackupSwitcher } from '@renderer/components'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Input } from '@/ui/input'
import { Switch } from '@/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import { cn } from '@/utils'
import type { VodSourceSpeedState } from '../types'

type SourceConfig = VodSourceConfig | IptvSourceConfig
type SpeedSortOrder = 'asc' | 'desc' | 'default'
interface TableDragState {
  pointerId: number
  scrollLeft: number
  startX: number
}
interface TableScrollEdges {
  left: boolean
  right: boolean
}

interface SourceTableCardProps<T extends SourceConfig> {
  addText: string
  allSelected: boolean
  apiAvailable: boolean
  emptyIcon: LucideIcon
  emptyText: string
  enabledCount: number
  heightClassName: string
  isBatchUpdating: boolean
  isClearing: boolean
  isReordering: boolean
  isTestingAll?: boolean
  selectedSourceIds: Set<string>
  sources: T[]
  speedResults?: Record<string, VodSourceSpeedState>
  tableLabel: string
  onAdd: () => void
  onBatchSetDisabled: (disabled: boolean) => void
  onClear: () => void
  onDelete: (source: T) => void
  onEdit: (source: T) => void
  onExport: () => void
  onImport: () => void
  onMoveToEdge: (sourceId: string, edge: 'start' | 'end') => void
  onTestAll?: () => void
  onTestSingle?: (sourceId: string) => void
  onSetDisabled: (source: T, disabled: boolean) => void
  onSwitchBackup?: (source: VodSourceConfig, backupUrl: string) => Promise<void>
  onToggleAll: () => void
  onToggleSelection: (sourceId: string) => void
}

/** 渲染源表格卡片 */
export function SourceTableCard<T extends SourceConfig>({
  addText,
  allSelected,
  apiAvailable,
  emptyIcon,
  emptyText,
  enabledCount,
  heightClassName,
  isBatchUpdating,
  isClearing,
  isReordering,
  isTestingAll = false,
  selectedSourceIds,
  sources,
  speedResults,
  tableLabel,
  onAdd,
  onBatchSetDisabled,
  onClear,
  onDelete,
  onEdit,
  onExport,
  onImport,
  onMoveToEdge,
  onTestAll,
  onTestSingle,
  onSetDisabled,
  onSwitchBackup,
  onToggleAll,
  onToggleSelection,
}: SourceTableCardProps<T>): React.JSX.Element {
  const [speedSortOrder, setSpeedSortOrder] = useState<SpeedSortOrder>('default')
  const [filterKeyword, setFilterKeyword] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [scrollEdges, setScrollEdges] = useState<TableScrollEdges>({ left: false, right: false })
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const dragStateRef = useRef<TableDragState | undefined>(undefined)
  const showBackups = Boolean(onSwitchBackup)
  const sortedSources = useMemo(() => {
    if (!onTestSingle || speedSortOrder === 'default') return sources
    return sources
      .map((source, index) => ({ source, index, result: speedResults?.[source.id] }))
      .sort((left, right) => {
        const leftSpeed = left.result?.status === 'success' ? left.result.elapsedMs : undefined
        const rightSpeed = right.result?.status === 'success' ? right.result.elapsedMs : undefined
        if (leftSpeed === undefined || rightSpeed === undefined) {
          if (leftSpeed === rightSpeed) return left.index - right.index
          return leftSpeed === undefined ? 1 : -1
        }
        const comparison = leftSpeed - rightSpeed || left.index - right.index
        return speedSortOrder === 'asc' ? comparison : -comparison
      })
      .map(({ source }) => source)
  }, [onTestSingle, sources, speedResults, speedSortOrder])
  const displayedSources = useMemo(() => {
    const keyword = filterKeyword.trim().toLowerCase()
    if (!keyword) return sortedSources
    return sortedSources.filter((source) => `${source.name} ${source.url}`.toLowerCase().includes(keyword))
  }, [filterKeyword, sortedSources])

  /** 循环切换速度排序顺序 */
  const cycleSpeedSortOrder = (): void => {
    setSpeedSortOrder((current) => (current === 'default' ? 'asc' : current === 'asc' ? 'desc' : 'default'))
  }

  /** 更新滚动边缘状态 */
  const updateScrollEdges = useCallback((): void => {
    const container = scrollContainerRef.current
    if (!container) return

    const nextEdges = {
      left: container.scrollLeft > 1,
      right: container.scrollLeft + container.clientWidth < container.scrollWidth - 1,
    }
    setScrollEdges((current) =>
      current.left === nextEdges.left && current.right === nextEdges.right ? current : nextEdges,
    )
  }, [])

  useLayoutEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    updateScrollEdges()
    const resizeObserver = new ResizeObserver(updateScrollEdges)
    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [displayedSources.length, showBackups, updateScrollEdges])

  /** 开始横向拖拽 */
  const startHorizontalDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || event.pointerType !== 'mouse') return
    const target = event.target as HTMLElement
    if (
      target.closest(
        'button, a, input, textarea, select, [role="button"], [role="checkbox"], [role="switch"], [data-table-drag-ignore]',
      )
    )
      return

    const container = scrollContainerRef.current
    if (!container || container.scrollWidth <= container.clientWidth) return

    dragStateRef.current = {
      pointerId: event.pointerId,
      scrollLeft: container.scrollLeft,
      startX: event.clientX,
    }
    container.setPointerCapture(event.pointerId)
    setIsDragging(true)
    event.preventDefault()
  }

  /** 根据指针位置更新横向拖拽距离 */
  const moveHorizontalDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const dragState = dragStateRef.current
    const container = scrollContainerRef.current
    if (!dragState || !container || dragState.pointerId !== event.pointerId) return

    container.scrollLeft = dragState.scrollLeft - (event.clientX - dragState.startX)
    updateScrollEdges()
    event.preventDefault()
  }

  /** 停止横向拖拽 */
  const stopHorizontalDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const dragState = dragStateRef.current
    const container = scrollContainerRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    if (container?.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId)
    dragStateRef.current = undefined
    setIsDragging(false)
  }

  return (
    <div className="min-w-0">
      <SourceToolbar
        addText={addText}
        apiAvailable={apiAvailable}
        clearText={isClearing ? '清空中' : '清空'}
        enabledCount={enabledCount}
        hasItems={sources.length > 0}
        isBatchUpdating={isBatchUpdating}
        isTestingAll={isTestingAll}
        filterKeyword={filterKeyword}
        selectedCount={selectedSourceIds.size}
        totalCount={sources.length}
        onAdd={onAdd}
        onBatchSetDisabled={onBatchSetDisabled}
        onClear={onClear}
        onExport={onExport}
        onImport={onImport}
        onFilterKeywordChange={setFilterKeyword}
        onTestAll={onTestAll}
      />

      {sources.length > 0 ? (
        <Table
          className="isolate min-w-[1140px] table-fixed border-separate border-spacing-0"
          containerClassName={cn(
            heightClassName,
            'border-border isolate overscroll-x-contain overflow-auto border-y',
            isDragging ? 'cursor-grabbing select-none' : 'cursor-grab',
          )}
          containerProps={{
            'aria-label': `${tableLabel}，可按住并左右拖动`,
            'role': 'region',
            'tabIndex': 0,
            'onLostPointerCapture': () => {
              dragStateRef.current = undefined
              setIsDragging(false)
            },
            'onPointerCancel': stopHorizontalDrag,
            'onPointerDown': startHorizontalDrag,
            'onPointerMove': moveHorizontalDrag,
            'onPointerUp': stopHorizontalDrag,
            'onScroll': updateScrollEdges,
          }}
          containerRef={scrollContainerRef}
        >
          <colgroup>
            <col className="w-9" />
            <col className="w-24" />
            <col className="w-[68px]" />
            <col className="w-[150px]" />
            <col />
            {showBackups ? <col className="w-[104px]" /> : null}
            {onTestSingle ? <col className="w-[126px]" /> : null}
            <col className="w-[164px]" />
          </colgroup>
          <SourceTableHeader
            allSelected={allSelected}
            scrollEdges={scrollEdges}
            showBackups={showBackups}
            showSpeed={Boolean(onTestSingle)}
            speedSortOrder={speedSortOrder}
            onSpeedSort={cycleSpeedSortOrder}
            onToggleAll={onToggleAll}
          />
          <TableBody>
            {displayedSources.length > 0 ? (
              displayedSources.map((source) => (
                <TableRow key={source.id} className="group hover:bg-muted h-14 border-0 [&>td]:border-b">
                  <TableCell className="bg-background group-hover:bg-muted sticky left-0 z-20 px-2 transition-colors">
                    <SelectionCheckbox
                      checked={selectedSourceIds.has(source.id)}
                      label={`选择 ${source.name}`}
                      onChange={() => onToggleSelection(source.id)}
                    />
                  </TableCell>
                  <TableCell className="bg-background group-hover:bg-muted sticky left-9 z-20 px-2 transition-colors">
                    <StatusCell
                      checked={!source.disabled}
                      onCheckedChange={(checked) => onSetDisabled(source, !checked)}
                    />
                  </TableCell>
                  <TableCell
                    className={cn(
                      'bg-background group-hover:bg-muted sticky left-[132px] z-20 px-2 transition-[background-color,box-shadow]',
                      scrollEdges.left && 'shadow-[5px_0_8px_-8px_rgba(0,0,0,0.45)]',
                    )}
                  >
                    <OriginCell origin={source.origin} />
                  </TableCell>
                  <TableCell className="max-w-[150px] px-3">
                    <NameCell name={source.name} />
                  </TableCell>
                  <TableCell className="max-w-0 px-3">
                    <SourceUrlCell name={source.name} url={source.url} />
                  </TableCell>
                  {isVodSource(source) && onSwitchBackup ? (
                    <TableCell className="px-2">
                      <BackupCell source={source} onSwitchBackup={onSwitchBackup} />
                    </TableCell>
                  ) : null}
                  {isVodSource(source) && onTestSingle ? (
                    <TableCell className="px-2">
                      <SpeedCell result={speedResults?.[source.id]} onTest={() => onTestSingle(source.id)} />
                    </TableCell>
                  ) : null}
                  <TableCell
                    className={cn(
                      'bg-background group-hover:bg-muted sticky right-0 z-20 px-2 transition-[background-color,box-shadow]',
                      scrollEdges.right && 'shadow-[-5px_0_8px_-8px_rgba(0,0,0,0.45)]',
                    )}
                  >
                    <ActionCell
                      disabled={isReordering}
                      isFirst={sources[0]?.id === source.id}
                      isLast={sources.at(-1)?.id === source.id}
                      onDelete={() => onDelete(source)}
                      onEdit={() => onEdit(source)}
                      onMoveToEdge={(edge) => onMoveToEdge(source.id, edge)}
                    />
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  className="text-muted-foreground h-32 text-center"
                  colSpan={6 + Number(showBackups) + Number(Boolean(onTestSingle))}
                >
                  未找到匹配的源
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      ) : (
        <EmptyTableState icon={emptyIcon} text={emptyText} />
      )}
    </div>
  )
}

/** 渲染可点击复制的源地址 */
function SourceUrlCell({ name, url }: { name: string; url: string }): React.JSX.Element {
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
function BackupCell({
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

/** 判断目标是否为点播源 */
function isVodSource(source: SourceConfig): source is VodSourceConfig {
  return 'backups' in source
}

/** 渲染源工具栏 */
function SourceToolbar({
  addText,
  apiAvailable,
  clearText,
  enabledCount,
  hasItems,
  isBatchUpdating,
  isTestingAll,
  filterKeyword,
  selectedCount,
  totalCount,
  onAdd,
  onBatchSetDisabled,
  onClear,
  onExport,
  onImport,
  onFilterKeywordChange,
  onTestAll,
}: {
  addText: string
  apiAvailable: boolean
  clearText: string
  enabledCount: number
  hasItems: boolean
  isBatchUpdating: boolean
  isTestingAll: boolean
  filterKeyword: string
  selectedCount: number
  totalCount: number
  onAdd: () => void
  onBatchSetDisabled: (disabled: boolean) => void
  onClear: () => void
  onExport: () => void
  onImport: () => void
  onFilterKeywordChange: (keyword: string) => void
  onTestAll?: () => void
}): React.JSX.Element {
  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{totalCount} 个源</Badge>
        <Badge variant="secondary">{enabledCount} 个启用</Badge>
        <Button
          disabled={!apiAvailable || selectedCount === 0 || isBatchUpdating}
          variant="outline"
          onClick={() => onBatchSetDisabled(false)}
        >
          批量开启{selectedCount > 0 ? ` (${selectedCount})` : ''}
        </Button>
        <Button
          disabled={!apiAvailable || selectedCount === 0 || isBatchUpdating}
          variant="outline"
          onClick={() => onBatchSetDisabled(true)}
        >
          批量关闭{selectedCount > 0 ? ` (${selectedCount})` : ''}
        </Button>
        <div className="relative w-full sm:ml-auto sm:w-72">
          <Input
            aria-label="筛选名称或 URL"
            className={filterKeyword ? 'h-10 pr-10' : 'h-10'}
            placeholder="筛选名称或 URL"
            value={filterKeyword}
            onChange={(event) => onFilterKeywordChange(event.target.value)}
          />
          {filterKeyword ? (
            <ActionTooltip label="清空筛选">
              <Button
                aria-label="清空筛选"
                className="absolute top-1/2 right-1 size-8 -translate-y-1/2"
                size="icon"
                type="button"
                variant="ghost"
                onClick={() => onFilterKeywordChange('')}
              >
                <X />
              </Button>
            </ActionTooltip>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={!apiAvailable} onClick={onAdd}>
          <Plus data-icon="inline-start" />
          {addText}
        </Button>
        <Button disabled={!apiAvailable} variant="outline" onClick={onImport}>
          <Upload data-icon="inline-start" />
          批量导入
        </Button>
        <Button disabled={!apiAvailable} variant="outline" onClick={onExport}>
          <Download data-icon="inline-start" />
          批量导出
        </Button>
        <div className="ml-auto" />
        <Button disabled={!apiAvailable || !hasItems || clearText === '清空中'} variant="destructive" onClick={onClear}>
          <Trash2 data-icon="inline-start" />
          {clearText}
        </Button>
        {onTestAll ? (
          <Button disabled={!apiAvailable || !hasItems || isTestingAll} variant="outline" onClick={onTestAll}>
            {isTestingAll ? (
              <RefreshCw className="animate-spin" data-icon="inline-start" />
            ) : (
              <Gauge data-icon="inline-start" />
            )}
            {isTestingAll ? '测速中' : '测速'}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** 渲染源表格标题 */
function SourceTableHeader({
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
function SelectionCheckbox({
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
function StatusCell({
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

/** 渲染来源单元格 */
function OriginCell({ origin }: { origin: SourceConfig['origin'] }): React.JSX.Element {
  return <Badge>{origin === 'subscription' ? '订阅' : '手动'}</Badge>
}

/** 渲染名称单元格 */
function NameCell({ name }: { name: string }): React.JSX.Element {
  return <div className="text-foreground min-w-0 truncate text-sm font-medium">{name}</div>
}

/** 渲染速度单元格 */
function SpeedCell({ result, onTest }: { result?: VodSourceSpeedState; onTest: () => void }): React.JSX.Element {
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
function ActionCell({
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
function EmptyTableState({ icon, text }: { icon: LucideIcon; text: string }): React.JSX.Element {
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
function ActionTooltip({ children, label }: { children: React.JSX.Element; label?: string }): React.JSX.Element {
  if (!label) return children
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
