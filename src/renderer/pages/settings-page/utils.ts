import { SEARCH_HISTORY_STORAGE_KEY } from '@shared/constants'
import type { ConfirmState } from './types'

/** 在选择集合中切换指定 ID */
export function toggleId(current: Set<string>, id: string): Set<string> {
  const next = new Set(current)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** 将指定项移动到列表边缘 */
export function moveItemToEdge<T extends { id: string }>(
  items: T[],
  id: string,
  edge: 'start' | 'end',
): T[] | undefined {
  const index = items.findIndex((item) => item.id === id)
  if (index < 0 || (edge === 'start' && index === 0) || (edge === 'end' && index === items.length - 1)) {
    return undefined
  }

  const nextItems = [...items]
  const [item] = nextItems.splice(index, 1)
  if (!item) return undefined
  if (edge === 'start') nextItems.unshift(item)
  else nextItems.push(item)
  return nextItems
}

/** 获取确认标题 */
export function getConfirmTitle(confirmState: ConfirmState): string {
  if (confirmState.type === 'clearSources') return '清空点播源'
  if (confirmState.type === 'clearIptvSources') return '清空 IPTV 源'
  if (confirmState.type === 'restoreFactorySettings') return '恢复出厂设置'
  if (confirmState.type === 'importAppData') return '导入应用数据'
  if (confirmState.type === 'deleteSource') return '删除点播源'
  if (confirmState.type === 'deleteSubscription') return '删除订阅源'
  if (confirmState.type === 'selectSubscription') return '切换订阅源'
  return '删除 IPTV 源'
}

/** 获取确认说明 */
export function getConfirmDescription(
  confirmState: ConfirmState,
  sourceCount: number,
  iptvSourceCount: number,
): string {
  if (confirmState.type === 'clearSources') {
    return `确定清空全部 ${sourceCount} 个点播源吗？此操作不可恢复。`
  }
  if (confirmState.type === 'clearIptvSources') {
    return `确定清空全部 ${iptvSourceCount} 个 IPTV 源吗？此操作不可恢复。`
  }
  if (confirmState.type === 'restoreFactorySettings') {
    return '确定恢复出厂设置吗？将重建数据库，清除全部数据、设置和缓存，并回到首次启动状态。此操作不可恢复，建议先导出备份。'
  }
  if (confirmState.type === 'importAppData') {
    return '确定导入应用数据吗？导入会覆盖当前订阅、VOD 源、IPTV 源、最近播放、收藏和搜索历史，不会合并当前数据。'
  }
  if (confirmState.type === 'deleteSource') {
    return `确定删除点播源「${confirmState.source.name}」吗？`
  }
  if (confirmState.type === 'deleteSubscription') {
    return '确定删除该订阅源吗？'
  }
  if (confirmState.type === 'selectSubscription') {
    return '确定切换订阅源吗？'
  }
  return `确定删除 IPTV 源「${confirmState.source.name}」吗？`
}

/** 加载需要随备份导出的搜索历史记录 */
export function loadSearchHistoriesForBackup(): string[] {
  try {
    const raw = window.localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}
