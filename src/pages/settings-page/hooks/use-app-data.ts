import { clearIptvPlaylistCache } from '../../iptv-page/utils'
import { useState } from 'react'
import { toast } from 'sonner'
import type { AppDataClearSelection } from '@/types'
import { clearAppData, exportDatabase, importDatabase, restartApp, restoreFactorySettings } from '@/platform/api'
import { clearVodCategoryCache } from '@/platform/cache/vod-catalog-categories'
import { clearVodCatalogPages } from '@/platform/cache/recommendation-cache'
import { useAppDataStore } from '@/stores'
import { clearIptvPreviewCache } from '../../iptv-page/preview-cache'

// Rust 执行数据库操作，前端负责反馈与释放内存缓存。
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
  exportData: () => Promise<void>
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
  const exportData = async (): Promise<void> => {
    if (!apiAvailable) return
    setIsExporting(true)
    try {
      const result = await exportDatabase()
      if (!result.cancelled) toast.success('数据库已导出', { description: result.filePath })
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
      const result = await importDatabase()
      if (result.cancelled) return
      toast.success('数据库已恢复，即将重启', { description: `恢复前备份：${result.safetyBackupPath}` })
      await restartApp()
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

/** 清理源相关的内存缓存 */
function clearSourceStorage(): void {
  clearCacheStorage()
}

/** 清理可重新获取的内存缓存 */
function clearCacheStorage(): void {
  clearIptvPlaylistCache()
  clearVodCategoryCache()
  clearVodCatalogPages()
  useAppDataStore.getState().clearRecommendationCache()
  clearIptvPreviewCache()
}
