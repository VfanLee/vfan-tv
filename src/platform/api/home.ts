import type { HomeData, HotRecommendationsPage, HotRecommendationsRequest } from '@/types'
import { invoke } from '@tauri-apps/api/core'
import { isDesktopRuntime } from '../tauri'

/** 读取首页推荐与本地最近播放 */
export async function getHomeData(): Promise<HomeData> {
  if (isDesktopRuntime()) return invoke('get_home_data')
  throw new Error('当前运行环境不支持此操作')
}

/** 按分类与筛选读取推荐分页 */
export async function getHotRecommendationsPage(input: HotRecommendationsRequest): Promise<HotRecommendationsPage> {
  if (isDesktopRuntime()) return invoke('get_hot_recommendations', { input })
  throw new Error('当前运行环境不支持此操作')
}
