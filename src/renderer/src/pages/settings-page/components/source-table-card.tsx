import { Check, Download, GripVertical, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import type { LiveSourceConfig, VodSourceConfig } from '@shared/types'
import { SettingsCard } from '@renderer/components'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import { cn } from '@renderer/utils/cn'

type SourceConfig = VodSourceConfig | LiveSourceConfig

interface SourceTableCardProps<T extends SourceConfig> {
  addText: string
  allSelected: boolean
  apiAvailable: boolean
  description: string
  draggedSourceId?: string
  dragOverSourceId?: string
  emptyText: string
  enabledCount: number
  heightClassName: string
  isBatchUpdating: boolean
  isClearing: boolean
  isReordering: boolean
  selectedSourceIds: Set<string>
  sources: T[]
  title: string
  onAdd: () => void
  onBatchToggle: (enabled: boolean) => void
  onClear: () => void
  onDelete: (source: T) => void
  onDragEnd: () => void
  onDragOver: (sourceId: string) => void
  onDragStart: (sourceId: string) => void
  onDrop: (sourceId: string) => void
  onEdit: (source: T) => void
  onExport: () => void
  onImport: () => void
  onToggle: (source: T, enabled: boolean) => void
  onToggleAll: () => void
  onToggleSelection: (sourceId: string) => void
}

export function SourceTableCard<T extends SourceConfig>({
  addText,
  allSelected,
  apiAvailable,
  description,
  draggedSourceId,
  dragOverSourceId,
  emptyText,
  enabledCount,
  heightClassName,
  isBatchUpdating,
  isClearing,
  isReordering,
  selectedSourceIds,
  sources,
  title,
  onAdd,
  onBatchToggle,
  onClear,
  onDelete,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onEdit,
  onExport,
  onImport,
  onToggle,
  onToggleAll,
  onToggleSelection,
}: SourceTableCardProps<T>): React.JSX.Element {
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
        selectedCount={selectedSourceIds.size}
        onAdd={onAdd}
        onBatchToggle={onBatchToggle}
        onClear={onClear}
        onExport={onExport}
        onImport={onImport}
      />

      {sources.length > 0 ? (
        <div className={cn(heightClassName, 'overflow-auto')}>
          <div className="min-w-[900px]">
            <TableHeader allSelected={allSelected} onToggleAll={onToggleAll} />
            {sources.map((source) => (
              <div
                key={source.id}
                className={rowClassName(draggedSourceId, dragOverSourceId, source.id)}
                onDragOver={(event) => {
                  if (!draggedSourceId || draggedSourceId === source.id) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  onDragOver(source.id)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  onDrop(source.id)
                }}
              >
                <DragHandle
                  disabled={isReordering}
                  label={`拖拽调整 ${source.name} 的顺序`}
                  onDragEnd={onDragEnd}
                  onDragStart={() => onDragStart(source.id)}
                />
                <SelectionCheckbox
                  checked={selectedSourceIds.has(source.id)}
                  label={`选择 ${source.name}`}
                  onChange={() => onToggleSelection(source.id)}
                />
                <StatusCell checked={source.enabled} onCheckedChange={(checked) => onToggle(source, checked)} />
                <OriginCell origin={source.origin} />
                <NameCell name={source.name} />
                <div className="text-muted-foreground min-w-0 truncate font-mono text-xs">{source.url}</div>
                <ActionCell onDelete={() => onDelete(source)} onEdit={() => onEdit(source)} />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyTableState text={emptyText} />
      )}
    </SettingsCard>
  )
}

function SourceToolbar({
  addText,
  apiAvailable,
  clearText,
  hasItems,
  isBatchUpdating,
  selectedCount,
  onAdd,
  onBatchToggle,
  onClear,
  onExport,
  onImport,
}: {
  addText: string
  apiAvailable: boolean
  clearText: string
  hasItems: boolean
  isBatchUpdating: boolean
  selectedCount: number
  onAdd: () => void
  onBatchToggle: (enabled: boolean) => void
  onClear: () => void
  onExport: () => void
  onImport: () => void
}): React.JSX.Element {
  return (
    <div className="border-border flex flex-wrap gap-2 border-b px-5 py-5">
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
      <div className="ml-auto" />
      <Button disabled={!apiAvailable} variant="outline" onClick={onImport}>
        <Upload data-icon="inline-start" />
        批量导入
      </Button>
      <Button disabled={!apiAvailable} variant="outline" onClick={onExport}>
        <Download data-icon="inline-start" />
        批量导出
      </Button>
      <Button disabled={!apiAvailable} onClick={onAdd}>
        <Plus data-icon="inline-start" />
        {addText}
      </Button>
      <Button disabled={!apiAvailable || !hasItems || clearText === '清空中'} variant="destructive" onClick={onClear}>
        <Trash2 data-icon="inline-start" />
        {clearText}
      </Button>
    </div>
  )
}

function TableHeader({
  allSelected,
  onToggleAll,
}: {
  allSelected: boolean
  onToggleAll: () => void
}): React.JSX.Element {
  return (
    <div className="border-border bg-muted text-muted-foreground sticky top-0 z-10 grid grid-cols-[32px_40px_112px_80px_1.1fr_2fr_132px] items-center border-b px-5 py-3 font-medium">
      <div aria-hidden="true" />
      <SelectionCheckbox checked={allSelected} label={allSelected ? '取消全选' : '全选源'} onChange={onToggleAll} />
      <div>状态</div>
      <div>来源</div>
      <div>名称</div>
      <div>URL</div>
      <div className="text-right">操作</div>
    </div>
  )
}

function DragHandle({
  disabled,
  label,
  onDragEnd,
  onDragStart,
}: {
  disabled: boolean
  label: string
  onDragEnd: () => void
  onDragStart: () => void
}): React.JSX.Element {
  return (
    <button
      aria-label={label}
      className="text-muted-foreground hover:text-foreground flex size-7 cursor-grab items-center justify-center rounded-lg active:cursor-grabbing disabled:cursor-default"
      disabled={disabled}
      draggable={!disabled}
      title="拖拽调整顺序"
      type="button"
      onDragEnd={onDragEnd}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
    >
      <GripVertical size={16} />
    </button>
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
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className="border-input bg-background text-primary focus-visible:ring-ring flex size-5 items-center justify-center rounded-xl border outline-none focus-visible:ring-2"
      role="checkbox"
      type="button"
      onClick={onChange}
    >
      {checked ? <Check size={14} strokeWidth={3} /> : null}
    </button>
  )
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

function ActionCell({ onDelete, onEdit }: { onDelete: () => void; onEdit: () => void }): React.JSX.Element {
  return (
    <div className="flex justify-end gap-2">
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

function rowClassName(draggedId: string | undefined, dragOverId: string | undefined, sourceId: string): string {
  return cn(
    'border-border grid grid-cols-[32px_40px_112px_80px_1.1fr_2fr_132px] items-center border-b px-5 py-4 transition-colors last:border-b-0',
    draggedId === sourceId && 'opacity-55',
    dragOverId === sourceId ? 'bg-accent/60' : 'hover:bg-muted',
  )
}
