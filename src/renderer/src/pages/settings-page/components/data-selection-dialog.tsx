import { useState } from 'react'
import type { AppDataSelection } from '@shared/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/alert-dialog'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'

type DataOperation = 'export' | 'initialize'

const baseOptions: Array<{ key: keyof AppDataSelection; label: string; description: string }> = [
  { key: 'sources', label: '数据源', description: '订阅、点播源和直播源会一并处理。' },
  { key: 'recent', label: '最近观看', description: '播放进度与观看记录。' },
  { key: 'favorites', label: '收藏', description: '已收藏的影视条目。' },
  { key: 'searchHistory', label: '搜索历史', description: '本机保存的搜索关键词。' },
]

const defaultSelection: AppDataSelection = {
  favorites: true,
  recent: true,
  searchHistory: true,
  sources: true,
}

export function DataSelectionDialog({
  isPending,
  mode,
  onCancel,
  onConfirm,
}: {
  isPending: boolean
  mode: DataOperation
  onCancel: () => void
  onConfirm: (selection: AppDataSelection) => Promise<void>
}): React.JSX.Element {
  const [selection, setSelection] = useState<AppDataSelection>(defaultSelection)
  const options = baseOptions
  const hasSelection = options.some((option) => selection[option.key])
  const allSelected = options.every((option) => selection[option.key])
  const title = mode === 'export' ? '选择导出数据' : '选择初始化数据'

  const confirm = async (): Promise<void> => {
    if (!hasSelection || isPending) return
    await onConfirm(selection)
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && !isPending && onCancel()}>
      <AlertDialogContent className="max-w-md" size="default">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {mode === 'export'
              ? '导入此备份时会全量初始化；未导出的数据不会保留。'
              : '仅清除勾选的数据，未勾选的数据会保留在本机。'}
          </AlertDialogDescription>
        </AlertDialogHeader>

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

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending} onClick={onCancel}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={!hasSelection || isPending}
            variant={mode === 'initialize' ? 'destructive' : 'default'}
            onClick={(event) => {
              event.preventDefault()
              void confirm()
            }}
          >
            {isPending ? '处理中...' : mode === 'export' ? '导出' : '初始化'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function createSelection(options: Array<{ key: keyof AppDataSelection }>, value: boolean): AppDataSelection {
  return options.reduce<AppDataSelection>(
    (selection, option) => ({ ...selection, [option.key]: value }),
    defaultSelection,
  )
}
