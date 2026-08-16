import { useState } from 'react'
import type { AppDataSelection } from '@shared/types'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'

/** 数据导入导出对话框的基础数据类别 */
const baseOptions: Array<{ key: keyof AppDataSelection; label: string; description: string }> = [
  { key: 'sources', label: '数据源', description: '订阅、VOD 源和 IPTV 源会一并处理。' },
  { key: 'recent', label: '最近观看', description: '播放进度与观看记录。' },
  { key: 'favorites', label: '收藏', description: '已收藏的影视条目。' },
  { key: 'searchHistory', label: '搜索历史', description: '本机保存的搜索关键词。' },
]

/** 数据导入导出对话框的默认选择状态 */
const defaultSelection: AppDataSelection = {
  favorites: true,
  recent: true,
  searchHistory: true,
  sources: true,
}

/** 渲染数据导入导出选择对话框 */
export function DataSelectionDialog({
  isPending,
  onCancel,
  onConfirm,
}: {
  isPending: boolean
  onCancel: () => void
  onConfirm: (selection: AppDataSelection) => Promise<void>
}): React.JSX.Element {
  const [selection, setSelection] = useState<AppDataSelection>(defaultSelection)
  /** 当前导入导出模式下可选择的数据类别 */
  const options = baseOptions
  const hasSelection = options.some((option) => selection[option.key])
  const allSelected = options.every((option) => selection[option.key])

  /** 确认当前对话框操作 */
  const confirm = async (): Promise<void> => {
    if (!hasSelection || isPending) return
    await onConfirm(selection)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !isPending && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>选择导出数据</DialogTitle>
          <DialogDescription>导入此备份时会全量覆盖业务数据；未导出的数据不会保留。</DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <Button
            className="-ml-2"
            size="sm"
            type="button"
            variant="ghost"
            onClick={() => setSelection(createSelection(options, !allSelected))}
          >
            {allSelected ? '取消全选' : '全选'}
          </Button>
          <div className="divide-y rounded-lg border">
            {options.map((option) => (
              <label key={option.key} className="flex cursor-pointer items-start gap-3 px-3 py-3">
                <Checkbox
                  checked={selection[option.key]}
                  className="mt-0.5"
                  onCheckedChange={(checked) =>
                    setSelection((current) => ({ ...current, [option.key]: checked === true }))
                  }
                />
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">{option.label}</span>
                  <span className="text-muted-foreground text-xs leading-5">{option.description}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={isPending} variant="outline">
              取消
            </Button>
          </DialogClose>
          <Button
            disabled={!hasSelection || isPending}
            onClick={(event) => {
              event.preventDefault()
              void confirm()
            }}
          >
            {isPending ? '处理中...' : '导出'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 创建对话框的数据选择状态 */
function createSelection(options: Array<{ key: keyof AppDataSelection }>, value: boolean): AppDataSelection {
  return options.reduce<AppDataSelection>(
    (selection, option) => ({ ...selection, [option.key]: value }),
    defaultSelection,
  )
}
