import { Download, Gauge, Plus, RefreshCw, Trash2, Upload, X } from 'lucide-react'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { ActionTooltip } from './source-table-cells'

/** 渲染源工具栏 */
export function SourceToolbar({
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
