import { useSourceTableScroll } from '../hooks/use-source-table-scroll'
import { isVodSource } from './source-table-utils'
import { useMemo, useState } from 'react'
import { Table, TableBody, TableCell, TableRow } from '@/ui/table'
import { cn } from '@/utils'
import { type SourceConfig, type SpeedSortOrder, type SourceTableCardProps } from './source-table-types'
import { SourceToolbar } from './source-table-toolbar'
import {
  SourceUrlCell,
  BackupCell,
  SourceTableHeader,
  SelectionCheckbox,
  StatusCell,
  OriginCell,
  NameCell,
  SpeedCell,
  ActionCell,
  EmptyTableState,
} from './source-table-cells'

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

  const {
    isDragging,
    scrollEdges,
    scrollContainerRef,
    updateScrollEdges,
    startHorizontalDrag,
    moveHorizontalDrag,
    stopHorizontalDrag,
  } = useSourceTableScroll(displayedSources.length, showBackups)

  /** 循环切换速度排序顺序 */
  const cycleSpeedSortOrder = (): void => {
    setSpeedSortOrder((current) => (current === 'default' ? 'asc' : current === 'asc' ? 'desc' : 'default'))
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
            'onLostPointerCapture': stopHorizontalDrag,
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
                    <OriginCell subscriptionId={source.subscriptionId} />
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
