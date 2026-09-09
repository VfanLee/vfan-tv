import { create } from 'zustand'
import { toast } from 'sonner'
import { changeSearchHistory, listSearchHistory } from '@/platform/api'
import { isDesktopRuntime } from '@/platform/tauri'

interface SearchHistoryState {
  histories: string[]
  refresh: () => Promise<void>
  change: (action: 'add' | 'remove' | 'clear', keyword?: string) => void
}

/** 串行读写，避免较早的读取响应覆盖新操作 */
let operations: Promise<void> = Promise.resolve()

/** 同步搜索历史数据库与窗口内状态 */
export const useSearchHistoryStore = create<SearchHistoryState>((set) => ({
  histories: [],
  refresh: () => {
    const operation = operations.then(async () => {
      if (isDesktopRuntime()) set({ histories: await listSearchHistory() })
    })
    operations = operation.catch((error: unknown) => {
      toast.error('读取搜索历史失败', { description: String(error) })
    })
    return operations
  },
  change: (action, keyword) => {
    operations = operations
      .then(async () => {
        if (isDesktopRuntime()) {
          await changeSearchHistory(action, keyword)
          set({ histories: await listSearchHistory() })
        } else {
          set((state) => ({
            histories:
              action === 'clear'
                ? []
                : action === 'remove'
                  ? state.histories.filter((item) => item !== keyword)
                  : keyword
                    ? [keyword, ...state.histories.filter((item) => item !== keyword)]
                    : state.histories,
          }))
        }
      })
      .catch((error: unknown) => {
        toast.error('保存搜索历史失败', { description: String(error) })
      })
  },
}))
