import { invoke } from '@tauri-apps/api/core'
import { isDesktopRuntime, subscribeDesktopEvent } from '../tauri'
import type { RecentPlayInput, RecentPlayItem, RecentUpdateCheckResult, RecentVodDetailRefresh } from '@/types'

/** 检查最近播放的原源详情，自动检查允许复用十分钟内的结果 */
export async function checkRecentUpdates(force = false, limit?: number): Promise<RecentUpdateCheckResult[]> {
  if (isDesktopRuntime()) return invoke('check_recent_updates', { force, limit })
  return []
}

/** 直接刷新当前视频详情，并更新已有最近播放记录的检查状态 */
export function refreshRecentVodDetail(sourceId: string, vodId: string): Promise<RecentVodDetailRefresh> {
  if (isDesktopRuntime()) return invoke('refresh_recent_vod_detail', { sourceId, vodId })
  throw new Error('当前运行环境不支持此操作')
}

/** 确认播放页已展示的更新版本，保留之后产生的新增提醒 */
export function acknowledgeRecentUpdate(sourceId: string, vodId: string, revision: string): Promise<void> {
  if (isDesktopRuntime()) return invoke('acknowledge_recent_update', { sourceId, vodId, revision })
  throw new Error('当前运行环境不支持此操作')
}

/** 订阅逐项检查及提醒确认结果，不触发新的联网检查 */
export function onRecentUpdatesChanged(listener: () => void): () => void {
  if (isDesktopRuntime()) return subscribeDesktopEvent('recent-updates-changed', listener)
  return () => {}
}

/** 读取最近播放 */
export async function listRecentPlays(limit?: number): Promise<RecentPlayItem[]> {
  if (isDesktopRuntime()) return invoke('list_recent_plays', { limit })
  return []
}

/** 保存播放进度 */
export async function upsertRecentPlay(input: RecentPlayInput): Promise<RecentPlayItem | undefined> {
  if (isDesktopRuntime()) return invoke('upsert_recent_play', { input })
  throw new Error('当前运行环境不支持此操作')
}

/** 按源与视频标识读取完整的播放进度 */
export async function getRecentPlay(sourceId: string, vodId: string): Promise<RecentPlayItem | null> {
  if (isDesktopRuntime()) return invoke('get_recent_play', { sourceId, vodId })
  return null
}

/** 删除播放记录 */
export async function removeRecentPlay(sourceId: string, vodId: string): Promise<void> {
  if (isDesktopRuntime()) return invoke('remove_recent_play', { sourceId, vodId })
  throw new Error('当前运行环境不支持此操作')
}
