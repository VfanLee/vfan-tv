import { useState } from 'react'
import { toast } from 'sonner'
import {
  IPTV_PLAYLIST_CACHE_PREFIX,
  IPTV_SELECTED_SOURCE_STORAGE_KEY,
  IPTV_SELECTION_STORAGE_PREFIX,
  SEARCH_HISTORY_STORAGE_KEY,
  VOD_CATALOG_SELECTED_SOURCE_STORAGE_KEY,
} from '@shared/constants'
import type { AppDataClearSelection, AppDataSelection } from '@shared/types'
import { clearAppData, exportAppData, importAppData, restartApp, restoreFactorySettings } from '@renderer/platform/api'
import { clearVodCategoryCache } from '@renderer/platform/cache/vod-catalog-categories'
import { clearIptvPreviewCache } from '../../iptv-page/preview-cache'
import { loadSearchHistoriesForBackup } from '../utils'

// main 进程执行文件导入导出；renderer 同步本地存储和页面状态。
interface AppDataOptions {
  apiAvailable: boolean
  resetIptvSources: () => void
  resetSubscription: () => void
  resetVodSources: () => void
}

export interface AppDataState {
  isExporting: boolean
  isClearingData: boolean
  isImporting: boolean
  isRestoringFactory: boolean
  exportData: (selection: AppDataSelection) => Promise<void>
  importData: () => Promise<void>
  clearData: (selection: AppDataClearSelection) => Promise<void>
  restoreFactorySettings: () => Promise<void>
}

/** 导入、导出、清理应用数据，并恢复出厂设置 */
export function useAppData({
  apiAvailable,
  resetIptvSources,
  resetSubscription,
  resetVodSources,
}: AppDataOptions): AppDataState {
  const [isRestoringFactory, setIsRestoringFactory] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isClearingData, setIsClearingData] = useState(false)

  /** 恢复应用出厂数据 */
  const restoreFactoryData = async (): Promise<void> => {
    if (!apiAvailable) return
    setIsRestoringFactory(true)
    try {
      await restoreFactorySettings()
      window.localStorage.clear()
      window.sessionStorage.clear()
      await restartApp()
    } catch (error) {
      toast.error('恢复出厂设置失败', { description: error instanceof Error ? error.message : String(error) })
      setIsRestoringFactory(false)
    }
  }

  /** 清除数据 */
  const clearData = async (selection: AppDataClearSelection): Promise<void> => {
    if (!apiAvailable) return
    setIsClearingData(true)
    try {
      await clearAppData(selection)
      if (selection.searchHistory) window.localStorage.removeItem(SEARCH_HISTORY_STORAGE_KEY)
      if (selection.sources) {
        resetVodSources()
        resetIptvSources()
        resetSubscription()
        clearSourceStorage()
      }
      if (selection.cache) clearCacheStorage()
      toast.success('数据已清除')
      window.setTimeout(() => window.location.reload(), 300)
    } catch (error) {
      toast.error('清除数据失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsClearingData(false)
    }
  }

  /** 导出数据 */
  const exportData = async (selection: AppDataSelection): Promise<void> => {
    if (!apiAvailable) return
    setIsExporting(true)
    try {
      const result = await exportAppData({ selection, searchHistory: loadSearchHistoriesForBackup() })
      if (result.cancelled) return
      toast.success('导出完成', {
        description: `VOD ${result.counts.vod}，IPTV ${result.counts.iptv}，最近观看 ${result.counts.recent}，收藏 ${result.counts.favorites}`,
      })
    } catch (error) {
      toast.error('导出失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsExporting(false)
    }
  }

  /** 导入数据 */
  const importData = async (): Promise<void> => {
    if (!apiAvailable) return
    setIsImporting(true)
    try {
      const result = await importAppData()
      if (result.cancelled) return
      // 从备份结果恢复 renderer 的搜索历史。
      window.localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(result.searchHistory))
      toast.success('导入完成', {
        description: `VOD ${result.counts.vod}，IPTV ${result.counts.iptv}，最近观看 ${result.counts.recent}，收藏 ${result.counts.favorites}`,
      })
      window.setTimeout(() => window.location.reload(), 300)
    } catch (error) {
      toast.error('导入失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsImporting(false)
    }
  }

  return {
    isClearingData,
    isExporting,
    isImporting,
    isRestoringFactory,
    clearData,
    exportData,
    importData,
    restoreFactorySettings: restoreFactoryData,
  }
}

/** 清除源存储 */
function clearSourceStorage(): void {
  clearVodCategoryCache()
  window.localStorage.removeItem(VOD_CATALOG_SELECTED_SOURCE_STORAGE_KEY)
  window.localStorage.removeItem(IPTV_SELECTED_SOURCE_STORAGE_KEY)
  removeLocalStorageByPrefix(IPTV_PLAYLIST_CACHE_PREFIX)
  removeLocalStorageByPrefix(IPTV_SELECTION_STORAGE_PREFIX)
  window.sessionStorage.clear()
  clearIptvPreviewCache()
}

/** 清除缓存存储 */
function clearCacheStorage(): void {
  clearVodCategoryCache()
  removeLocalStorageByPrefix(IPTV_PLAYLIST_CACHE_PREFIX)
  removeLocalStorageByPrefix(IPTV_SELECTION_STORAGE_PREFIX)
  window.sessionStorage.clear()
  clearIptvPreviewCache()
}

/** 按键名前缀删除本地存储项 */
function removeLocalStorageByPrefix(prefix: string): void {
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index)
    if (key?.startsWith(prefix)) window.localStorage.removeItem(key)
  }
}
