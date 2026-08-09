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

// 应用数据的文件操作在 main 执行；renderer 仅负责同步自己的 localStorage 与页面状态。
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

  const importData = async (): Promise<void> => {
    if (!apiAvailable) return
    setIsImporting(true)
    try {
      const result = await importAppData()
      if (result.cancelled) return
      // 搜索历史只存在 renderer 存储中，需要从备份结果单独恢复。
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

function clearSourceStorage(): void {
  clearVodCategoryCache()
  window.localStorage.removeItem(VOD_CATALOG_SELECTED_SOURCE_STORAGE_KEY)
  window.localStorage.removeItem(IPTV_SELECTED_SOURCE_STORAGE_KEY)
  removeLocalStorageByPrefix(IPTV_PLAYLIST_CACHE_PREFIX)
  removeLocalStorageByPrefix(IPTV_SELECTION_STORAGE_PREFIX)
  window.sessionStorage.clear()
  clearIptvPreviewCache()
}

function clearCacheStorage(): void {
  clearVodCategoryCache()
  removeLocalStorageByPrefix(IPTV_PLAYLIST_CACHE_PREFIX)
  removeLocalStorageByPrefix(IPTV_SELECTION_STORAGE_PREFIX)
  window.sessionStorage.clear()
  clearIptvPreviewCache()
}

function removeLocalStorageByPrefix(prefix: string): void {
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index)
    if (key?.startsWith(prefix)) window.localStorage.removeItem(key)
  }
}
