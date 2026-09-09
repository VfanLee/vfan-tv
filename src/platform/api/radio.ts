import { invoke } from '@tauri-apps/api/core'
import { isDesktopRuntime } from '../tauri'
import type { RadioCategory, RadioChannel, RadioLiveProgram, RadioRegion, RadioSearchResult } from '@/types'

/** 读取电台分类 */
export function getRadioCategories(): Promise<RadioCategory[]> {
  if (isDesktopRuntime()) return invoke('radio_request', { input: { operation: 'categories' } })
  throw new Error('当前运行环境不支持此操作')
}

/** 读取分类电台 */
export function getRadioCategoryChannels(categoryId: number, page = 1, pageSize = 20): Promise<RadioChannel[]> {
  if (isDesktopRuntime())
    return invoke('radio_request', { input: { operation: 'categoryChannels', categoryId, page, pageSize } })
  throw new Error('当前运行环境不支持此操作')
}

/** 读取电台详情 */
export function getRadioChannelDetail(channelId: number): Promise<RadioChannel> {
  if (isDesktopRuntime()) return invoke('radio_request', { input: { operation: 'detail', channelId } })
  throw new Error('当前运行环境不支持此操作')
}

/** 搜索电台 */
export function searchRadioChannels(keyword: string, page = 1, pageSize = 30): Promise<RadioSearchResult> {
  if (isDesktopRuntime()) return invoke('radio_request', { input: { operation: 'search', keyword, page, pageSize } })
  throw new Error('当前运行环境不支持此操作')
}

/** 读取当前节目 */
export function getRadioLivePrograms(channelIds: number[]): Promise<RadioLiveProgram[]> {
  if (isDesktopRuntime()) return invoke('radio_request', { input: { operation: 'programs', channelIds } })
  throw new Error('当前运行环境不支持此操作')
}

/** 读取电台地区 */
export function getRadioRegions(): Promise<RadioRegion[]> {
  if (isDesktopRuntime()) return invoke('radio_request', { input: { operation: 'regions' } })
  throw new Error('当前运行环境不支持此操作')
}

/** 读取电台榜单 */
export function getRadioBillboard(categoryId: number, regionId: number): Promise<RadioChannel[]> {
  if (isDesktopRuntime()) return invoke('radio_request', { input: { operation: 'billboard', categoryId, regionId } })
  throw new Error('当前运行环境不支持此操作')
}

/** 创建可随播放器释放的电台媒体会话 */
export async function getRadioPlaybackTarget(channelId: number): Promise<{ src: string; mediaSessionId?: string }> {
  if (isDesktopRuntime()) return invoke('get_radio_playback_target', { channelId })
  throw new Error('当前运行环境不支持此操作')
}
