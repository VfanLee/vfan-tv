import {
  CUSTOM_GITHUB_PROXY_ROUTE_ID,
  DEFAULT_GITHUB_PROXY_ROUTE_ID,
  GITHUB_PROXY_ROUTES,
  SEARCH_HISTORY_STORAGE_KEY,
} from '@shared/constants'
import type { GitHubProxyRouteId, GitHubProxyTestResult } from '@shared/types'
import type { ConfirmState, GitHubProxySpeedState } from './types'

export function toggleId(current: Set<string>, id: string): Set<string> {
  const next = new Set(current)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export function moveItem<T extends { id: string }>(items: T[], activeId: string, targetId: string): T[] | undefined {
  const fromIndex = items.findIndex((item) => item.id === activeId)
  const toIndex = items.findIndex((item) => item.id === targetId)

  if (fromIndex < 0 || toIndex < 0) return undefined

  const nextItems = [...items]
  const [movedItem] = nextItems.splice(fromIndex, 1)
  if (!movedItem) return undefined

  nextItems.splice(toIndex, 0, movedItem)
  return nextItems
}

export function createIdleGitHubProxySpeedResults(): Record<GitHubProxyRouteId, GitHubProxySpeedState> {
  const routeIds: GitHubProxyRouteId[] = [...GITHUB_PROXY_ROUTES.map((route) => route.id), CUSTOM_GITHUB_PROXY_ROUTE_ID]
  return Object.fromEntries(routeIds.map((routeId) => [routeId, { status: 'idle' }])) as Record<
    GitHubProxyRouteId,
    GitHubProxySpeedState
  >
}

export function getFastestGitHubProxyResult(results: GitHubProxyTestResult[]): GitHubProxyTestResult | undefined {
  return results.reduce<GitHubProxyTestResult | undefined>((fastest, result) => {
    if (result.status !== 'success' || typeof result.elapsedMs !== 'number') return fastest
    if (!fastest || typeof fastest.elapsedMs !== 'number' || result.elapsedMs < fastest.elapsedMs) return result
    return fastest
  }, undefined)
}

export function resolveVisibleGitHubProxyRoute(routeId: GitHubProxyRouteId | undefined): GitHubProxyRouteId {
  if (routeId && GITHUB_PROXY_ROUTES.some((route) => route.id === routeId)) return routeId
  return DEFAULT_GITHUB_PROXY_ROUTE_ID
}

export function getGitHubProxyRouteLabel(routeId: GitHubProxyRouteId): string {
  if (routeId === CUSTOM_GITHUB_PROXY_ROUTE_ID) return '自定义代理'
  return GITHUB_PROXY_ROUTES.find((item) => item.id === routeId)?.label ?? routeId
}

export function formatSpeedResult(result: GitHubProxySpeedState | undefined): string {
  if (!result || result.status === 'idle') return '待测速'
  if (result.status === 'testing') return '测速中'
  if (result.status === 'error') return result.errorMessage ?? '不可用'
  return typeof result.elapsedMs === 'number' ? `${result.elapsedMs} ms` : '未知'
}

export function getSpeedResultTagClassName(result: GitHubProxySpeedState | undefined): string {
  if (!result || result.status === 'idle') return 'bg-muted text-muted-foreground'
  if (result.status === 'testing') return 'bg-primary/10 text-primary'
  if (result.status === 'error') return 'bg-destructive/10 text-destructive'
  if (typeof result.elapsedMs !== 'number') return 'bg-muted text-muted-foreground'
  if (result.elapsedMs <= 800) return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (result.elapsedMs <= 2000) return 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400'
  return 'bg-orange-500/15 text-orange-700 dark:text-orange-400'
}

export function getConfirmTitle(confirmState: ConfirmState): string {
  if (confirmState.type === 'clearSources') return '清空点播源'
  if (confirmState.type === 'clearLiveSources') return '清空直播源'
  if (confirmState.type === 'initializeAppData') return '初始化应用数据'
  if (confirmState.type === 'importAppData') return '导入应用数据'
  if (confirmState.type === 'deleteSource') return '删除点播源'
  return '删除直播源'
}

export function getConfirmDescription(
  confirmState: ConfirmState,
  sourceCount: number,
  liveSourceCount: number,
): string {
  if (confirmState.type === 'clearSources') {
    return `确定清空全部 ${sourceCount} 个点播源吗？此操作不可恢复。`
  }
  if (confirmState.type === 'clearLiveSources') {
    return `确定清空全部 ${liveSourceCount} 个直播源吗？此操作不可恢复。`
  }
  if (confirmState.type === 'initializeAppData') {
    return '确定初始化吗？这会清空设置、VOD 源、直播源、最近播放、收藏、搜索历史和本地缓存，回到新安装状态。此操作不可恢复。'
  }
  if (confirmState.type === 'importAppData') {
    return '确定导入应用数据吗？导入会覆盖当前订阅、VOD 源、直播源、最近播放、收藏和搜索历史，不会合并当前数据。'
  }
  if (confirmState.type === 'deleteSource') {
    return `确定删除点播源「${confirmState.source.name}」吗？`
  }
  return `确定删除直播源「${confirmState.source.name}」吗？`
}

export function loadSearchHistoriesForBackup(): string[] {
  try {
    const raw = window.localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}
