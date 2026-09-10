import { invoke } from '@tauri-apps/api/core'
import { isDesktopRuntime } from '../tauri'
import type { RecentPlayInput, RecentPlayItem } from '@/types'

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
