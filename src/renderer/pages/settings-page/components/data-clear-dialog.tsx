import { useState } from 'react'
import type { AppDataClearSelection } from '@shared/types'
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
import { Checkbox } from '@/ui/checkbox'

/** 数据清理对话框可选择的数据类别 */
const options: Array<{ key: keyof AppDataClearSelection; label: string; description: string }> = [
  { key: 'sources', label: '数据源', description: '订阅、VOD/IPTV 源及源关联缓存。' },
  { key: 'recent', label: '最近观看', description: '播放进度与观看记录。' },
  { key: 'favorites', label: '收藏', description: '已收藏的影视条目。' },
  { key: 'searchHistory', label: '搜索历史', description: '本机保存的搜索关键词，不改变展示偏好。' },
  { key: 'cache', label: '缓存', description: '网页、频道、预览、分类与页面临时缓存。' },
]

/** 数据清理对话框的空白选择状态 */
const emptySelection: AppDataClearSelection = {
  cache: false,
  favorites: false,
  recent: false,
  searchHistory: false,
  sources: false,
}

/** 渲染数据清理对话框 */
export function DataClearDialog({
  isPending,
  onCancel,
  onConfirm,
}: {
  isPending: boolean
  onCancel: () => void
  onConfirm: (selection: AppDataClearSelection) => Promise<void>
}): React.JSX.Element {
  const [selection, setSelection] = useState<AppDataClearSelection>(emptySelection)
  const hasSelection = options.some((option) => selection[option.key])

  return (
    <AlertDialog open onOpenChange={(open) => !open && !isPending && onCancel()}>
      <AlertDialogContent className="max-w-md" size="default">
        <AlertDialogHeader>
          <AlertDialogTitle>选择要清除的数据</AlertDialogTitle>
          <AlertDialogDescription>只清除勾选的数据，外观、网络和播放器偏好会保留。</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="divide-y rounded-lg border">
          {options.map((option) => (
            <label key={option.key} className="flex cursor-pointer items-start gap-3 px-3 py-3">
              <Checkbox
                checked={selection[option.key]}
                className="mt-0.5"
                disabled={isPending}
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

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending} onClick={onCancel}>
            取消
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={!hasSelection || isPending}
            variant="destructive"
            onClick={(event) => {
              event.preventDefault()
              if (hasSelection && !isPending) void onConfirm(selection)
            }}
          >
            {isPending ? '清除中...' : '清除数据'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
