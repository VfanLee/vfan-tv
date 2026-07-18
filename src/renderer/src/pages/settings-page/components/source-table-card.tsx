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
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { LiveSourceConfig, VodSourceConfig } from '@shared/types'
import { SettingsCard } from '@renderer/components'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Input } from '@/ui/input'
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/ui/popover'
import { RadioGroup, RadioGroupItem } from '@/ui/radio-group'
import { Switch } from '@/ui/switch'
import { cn } from '@/utils'
import type { VodSourceSpeedState } from '../types'

type SourceConfig = VodSourceConfig | LiveSourceConfig
type SpeedSortOrder = 'asc' | 'desc' | 'default'

interface SourceTableCardProps<T extends SourceConfig> {
  addText: string
  allSelected: boolean
  apiAvailable: boolean
  description: string
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
  title: string
  onAdd: () => void
  onBatchToggle: (enabled: boolean) => void
  onClear: () => void
  onDelete: (source: T) => void
  onEdit: (source: T) => void
  onExport: () => void
  onImport: () => void
  onMoveToEdge: (sourceId: string, edge: 'start' | 'end') => void
  onTestAll?: () => void
  onTestSingle?: (sourceId: string) => void
  onToggle: (source: T, enabled: boolean) => void
  onSwitchBackup?: (source: VodSourceConfig, backupUrl: string) => Promise<void>
  onToggleAll: () => void
  onToggleSelection: (sourceId: string) => void
}

export function SourceTableCard<T extends SourceConfig>({
  addText,
  allSelected,
  apiAvailable,
  description,
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
  title,
  onAdd,
  onBatchToggle,
  onClear,
  onDelete,
  onEdit,
  onExport,
  onImport,
  onMoveToEdge,
  onTestAll,
  onTestSingle,
  onToggle,
  onSwitchBackup,
  onToggleAll,
  onToggleSelection,
}: SourceTableCardProps<T>): React.JSX.Element {
  const [speedSortOrder, setSpeedSortOrder] = useState<SpeedSortOrder>('default')
  const [filterKeyword, setFilterKeyword] = useState('')
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

  const cycleSpeedSortOrder = (): void => {
    setSpeedSortOrder((current) => (current === 'default' ? 'asc' : current === 'asc' ? 'desc' : 'default'))
  }

  return (
    <SettingsCard
      description={description}
      headerActions={
        <div className="flex flex-wrap gap-2">
          <Badge>{sources.length} 个源</Badge>
          <Badge variant="secondary">{enabledCount} 个启用</Badge>
        </div>
      }
      title={title}
    >
      <SourceToolbar
        addText={addText}
        apiAvailable={apiAvailable}
        clearText={isClearing ? '清空中' : '清空'}
        hasItems={sources.length > 0}
        isBatchUpdating={isBatchUpdating}
        isTestingAll={isTestingAll}
        filterKeyword={filterKeyword}
        selectedCount={selectedSourceIds.size}
        onAdd={onAdd}
        onBatchToggle={onBatchToggle}
        onClear={onClear}
        onExport={onExport}
        onImport={onImport}
        onFilterKeywordChange={setFilterKeyword}
        onTestAll={onTestAll}
      />

      {sources.length > 0 ? (
        <div className={cn(heightClassName, 'overflow-auto')}>
          <div className="min-w-[1160px]">
            <TableHeader
              allSelected={allSelected}
              showBackups={showBackups}
              showSpeed={Boolean(onTestSingle)}
              speedSortOrder={speedSortOrder}
              onSpeedSort={cycleSpeedSortOrder}
              onToggleAll={onToggleAll}
            />
            {displayedSources.length > 0 ? (
              displayedSources.map((source) => (
                <div
                  key={source.id}
                  className={cn(
                    'border-border hover:bg-muted/30 grid items-center border-b px-5 py-3 transition-colors',
                    getTableGridClassName(Boolean(onTestSingle), showBackups),
                  )}
                >
                  <SelectionCheckbox
                    checked={selectedSourceIds.has(source.id)}
                    label={`选择 ${source.name}`}
                    onChange={() => onToggleSelection(source.id)}
                  />
                  <StatusCell checked={source.enabled} onCheckedChange={(checked) => onToggle(source, checked)} />
                  <OriginCell origin={source.origin} />
                  <NameCell name={source.name} />
                  <div className="text-muted-foreground min-w-0 truncate font-mono text-xs" title={source.url}>
                    {source.url}
                  </div>
                  {isVodSource(source) && onSwitchBackup ? (
                    <BackupCell source={source} onSwitchBackup={onSwitchBackup} />
                  ) : null}
                  {isVodSource(source) && onTestSingle ? (
                    <SpeedCell result={speedResults?.[source.id]} onTest={() => onTestSingle(source.id)} />
                  ) : null}
                  <ActionCell
                    disabled={isReordering}
                    isFirst={sources[0]?.id === source.id}
                    isLast={sources.at(-1)?.id === source.id}
                    onDelete={() => onDelete(source)}
                    onEdit={() => onEdit(source)}
                    onMoveToEdge={(edge) => onMoveToEdge(source.id, edge)}
                  />
                </div>
              ))
            ) : (
              <EmptyTableState text="未找到匹配的源" />
            )}
          </div>
        </div>
      ) : (
        <EmptyTableState text={emptyText} />
      )}
    </SettingsCard>
  )
}

function BackupCell({
  source,
  onSwitchBackup,
}: {
  source: VodSourceConfig
  onSwitchBackup: (source: VodSourceConfig, backupUrl: string) => Promise<void>
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [switchingUrl, setSwitchingUrl] = useState<string>()

  const switchTo = async (backupUrl: string): Promise<void> => {
    setSwitchingUrl(backupUrl)
    try {
      await onSwitchBackup(source, backupUrl)
      setOpen(false)
    } finally {
      setSwitchingUrl(undefined)
    }
  }

  return (
    <div className="flex min-w-0 items-center">
      {source.backups.length > 0 ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button className="shrink-0" size="xs" title="切换备用地址" type="button" variant="outline">
              {source.backups.length} 个备用
              <ChevronDown data-icon="inline-end" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(30rem,calc(100vw-5rem))] gap-0 p-2">
            <PopoverHeader className="px-2 py-2">
              <PopoverTitle className="text-sm font-semibold">切换地址</PopoverTitle>
              <PopoverDescription className="mt-0.5 text-xs">选择备用地址后立即切换。</PopoverDescription>
            </PopoverHeader>
            <RadioGroup
              className="border-border border-y py-1"
              value={source.url}
              onValueChange={(url) => {
                if (url !== source.url) void switchTo(url)
              }}
            >
              <AddressRadioItem
                current
                endpoint={{ url: source.url, referer: source.referer }}
                itemId={`${source.id}-current`}
              />
              {source.backups.map((backup, index) => (
                <AddressRadioItem
                  endpoint={backup}
                  itemId={`${source.id}-backup-${index}`}
                  key={backup.url}
                  loading={switchingUrl === backup.url}
                />
              ))}
            </RadioGroup>
          </PopoverContent>
        </Popover>
      ) : null}
      {source.backups.length === 0 ? <span className="text-muted-foreground text-xs">无</span> : null}
    </div>
  )
}

function AddressRadioItem({
  current = false,
  endpoint,
  itemId,
  loading = false,
}: {
  current?: boolean
  endpoint: { url: string; referer?: string }
  itemId: string
  loading?: boolean
}): React.JSX.Element {
  return (
    <label
      className="hover:bg-muted has-[[data-slot=radio-group-item]:focus-visible]:ring-ring flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 has-[[data-slot=radio-group-item]:disabled]:cursor-not-allowed has-[[data-slot=radio-group-item]:disabled]:opacity-60 has-[[data-slot=radio-group-item]:focus-visible]:ring-2"
      htmlFor={itemId}
    >
      <RadioGroupItem disabled={loading} id={itemId} value={endpoint.url} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-xs">{endpoint.url}</span>
        {endpoint.referer ? (
          <span className="text-muted-foreground mt-1 block truncate text-xs">Referer: {endpoint.referer}</span>
        ) : null}
      </span>
      {current ? (
        <Badge variant="secondary">正在使用</Badge>
      ) : loading ? (
        <span className="text-muted-foreground text-xs">切换中</span>
      ) : null}
    </label>
  )
}

function isVodSource(source: SourceConfig): source is VodSourceConfig {
  return 'backups' in source
}

function SourceToolbar({
  addText,
  apiAvailable,
  clearText,
  hasItems,
  isBatchUpdating,
  isTestingAll,
  filterKeyword,
  selectedCount,
  onAdd,
  onBatchToggle,
  onClear,
  onExport,
  onImport,
  onFilterKeywordChange,
  onTestAll,
}: {
  addText: string
  apiAvailable: boolean
  clearText: string
  hasItems: boolean
  isBatchUpdating: boolean
  isTestingAll: boolean
  filterKeyword: string
  selectedCount: number
  onAdd: () => void
  onBatchToggle: (enabled: boolean) => void
  onClear: () => void
  onExport: () => void
  onImport: () => void
  onFilterKeywordChange: (keyword: string) => void
  onTestAll?: () => void
}): React.JSX.Element {
  return (
    <div className="border-border border-b px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={!apiAvailable || selectedCount === 0 || isBatchUpdating}
          variant="outline"
          onClick={() => onBatchToggle(true)}
        >
          批量开启{selectedCount > 0 ? ` (${selectedCount})` : ''}
        </Button>
        <Button
          disabled={!apiAvailable || selectedCount === 0 || isBatchUpdating}
          variant="outline"
          onClick={() => onBatchToggle(false)}
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
            <Button
              className="absolute top-1/2 right-1 size-8 -translate-y-1/2"
              size="icon"
              title="清空筛选"
              type="button"
              variant="ghost"
              onClick={() => onFilterKeywordChange('')}
            >
              <X />
            </Button>
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

function TableHeader({
  allSelected,
  showBackups,
  showSpeed,
  speedSortOrder,
  onSpeedSort,
  onToggleAll,
}: {
  allSelected: boolean
  showBackups: boolean
  showSpeed: boolean
  speedSortOrder: SpeedSortOrder
  onSpeedSort: () => void
  onToggleAll: () => void
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'border-border bg-muted text-muted-foreground sticky top-0 z-10 grid items-center border-b px-5 py-3 font-medium',
        getTableGridClassName(showSpeed, showBackups),
      )}
    >
      <SelectionCheckbox checked={allSelected} label={allSelected ? '取消全选' : '全选源'} onChange={onToggleAll} />
      <div>状态</div>
      <div>来源</div>
      <div>名称</div>
      <div>URL</div>
      {showBackups ? <div>备用地址</div> : null}
      {showSpeed ? (
        <div>
          <button
            className="hover:text-foreground inline-flex items-center gap-1 rounded-sm outline-none focus-visible:ring-2"
            title={getSpeedSortTitle(speedSortOrder)}
            type="button"
            onClick={onSpeedSort}
          >
            API 延迟
            {speedSortOrder === 'asc' ? <ArrowUpToLine size={15} /> : null}
            {speedSortOrder === 'desc' ? <ArrowDownToLine size={15} /> : null}
          </button>
        </div>
      ) : null}
      <div className="text-right">操作</div>
    </div>
  )
}

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

function OriginCell({ origin }: { origin: SourceConfig['origin'] }): React.JSX.Element {
  return <Badge>{origin === 'subscription' ? '订阅' : '手动'}</Badge>
}

function NameCell({ name }: { name: string }): React.JSX.Element {
  return <div className="text-foreground min-w-0 truncate text-sm font-medium">{name}</div>
}

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
      <Badge className={cn('max-w-20 truncate', resultClassName)} title={title} variant="secondary">
        {label}
      </Badge>
      <Button className="h-8 px-2" disabled={testing} title="测速" variant="ghost" onClick={onTest}>
        {testing ? <RefreshCw className="animate-spin" /> : <Gauge />}
      </Button>
    </div>
  )
}

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
    <div className="flex justify-end gap-2">
      <Button
        className="h-8 px-2"
        disabled={disabled || isFirst}
        title="置顶"
        variant="ghost"
        onClick={() => onMoveToEdge('start')}
      >
        <ArrowUpToLine />
      </Button>
      <Button
        className="h-8 px-2"
        disabled={disabled || isLast}
        title="置底"
        variant="ghost"
        onClick={() => onMoveToEdge('end')}
      >
        <ArrowDownToLine />
      </Button>
      <Button className="h-8 px-2" title="编辑" variant="ghost" onClick={onEdit}>
        <Pencil />
      </Button>
      <Button className="h-8 px-2" title="删除" variant="destructive" onClick={onDelete}>
        <Trash2 />
      </Button>
    </div>
  )
}

function EmptyTableState({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="px-5 py-6">
      <div className="border-input rounded-xl p-10 text-center">
        <div className="text-muted-foreground text-sm font-semibold">{text}</div>
      </div>
    </div>
  )
}

function getTableGridClassName(showSpeed: boolean, showBackups: boolean): string {
  if (showBackups && showSpeed) return 'grid-cols-[40px_112px_80px_1.1fr_1.8fr_120px_150px_196px]'
  if (showBackups) return 'grid-cols-[40px_112px_80px_1.1fr_1.8fr_120px_196px]'
  if (showSpeed) return 'grid-cols-[40px_112px_80px_1.1fr_2fr_150px_196px]'
  return 'grid-cols-[40px_112px_80px_1.1fr_2fr_196px]'
}

function getSpeedSortTitle(order: SpeedSortOrder): string {
  if (order === 'default') return '按速度从快到慢排序'
  if (order === 'asc') return '按速度从慢到快排序'
  return '恢复默认排序'
}
