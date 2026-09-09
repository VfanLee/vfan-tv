import { invoke } from '@tauri-apps/api/core'
import { isDesktopRuntime } from '../tauri'
import type { FavoriteInput, FavoriteItem } from '@/types'

/** 读取收藏列表 */
export async function listFavorites(): Promise<FavoriteItem[]> {
  if (isDesktopRuntime()) return invoke('list_favorites', {})
  return []
}

/** 读取收藏状态 */
export async function isFavorite(sourceId: string, vodId: string): Promise<boolean> {
  if (isDesktopRuntime()) return invoke('is_favorite', { sourceId, vodId })
  throw new Error('当前运行环境不支持此操作')
}

/** 新增或更新收藏 */
export async function addFavorite(input: FavoriteInput): Promise<FavoriteItem> {
  if (isDesktopRuntime()) return invoke('add_favorite', { input })
  throw new Error('当前运行环境不支持此操作')
}

/** 删除收藏 */
export async function removeFavorite(sourceId: string, vodId: string): Promise<void> {
  if (isDesktopRuntime()) return invoke('remove_favorite', { sourceId, vodId })
  throw new Error('当前运行环境不支持此操作')
}
