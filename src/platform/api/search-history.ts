import { invoke } from '@tauri-apps/api/core'

/** 读取持久化搜索历史 */
export function listSearchHistory(): Promise<string[]> {
  return invoke('list_search_history')
}

/** 按条目更新历史，避免多个窗口相互覆盖 */
export function changeSearchHistory(action: 'add' | 'remove' | 'clear', keyword?: string): Promise<void> {
  return invoke('change_search_history', { action, keyword })
}
