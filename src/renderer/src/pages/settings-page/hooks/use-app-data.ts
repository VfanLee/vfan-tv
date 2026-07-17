import { useState } from 'react'
import { toast } from 'sonner'
import { SEARCH_HISTORY_STORAGE_KEY } from '@shared/constants'
import { exportAppData, importAppData, initializeAppData } from '@renderer/services/api'
import { loadSearchHistoriesForBackup } from '../utils'

// 应用数据的文件操作在 main 执行；renderer 仅负责同步自己的 localStorage 与页面状态。
interface AppDataOptions {
  apiAvailable: boolean
  resetLiveSources: () => void
  resetSubscription: () => void
  resetVodSources: () => void
}

export interface AppDataState {
  isExporting: boolean
  isImporting: boolean
  isInitializing: boolean
  exportData: () => Promise<void>
  importData: () => Promise<void>
  initializeData: () => Promise<void>
}

export function useAppData({
  apiAvailable,
  resetLiveSources,
  resetSubscription,
  resetVodSources,
}: AppDataOptions): AppDataState {
  const [isInitializing, setIsInitializing] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)

  const initializeData = async (): Promise<void> => {
    if (!apiAvailable) return
    setIsInitializing(true)
    try {
      await initializeAppData()
      // 数据库初始化会清空主进程数据，renderer 存储也必须同时清空。
      window.localStorage.clear()
      resetVodSources()
      resetLiveSources()
      resetSubscription()
      toast.success('初始化完成')
      window.setTimeout(() => window.location.reload(), 300)
    } catch (error) {
      toast.error('初始化失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsInitializing(false)
    }
  }

  const exportData = async (): Promise<void> => {
    if (!apiAvailable) return
    setIsExporting(true)
    try {
      const result = await exportAppData({ searchHistory: loadSearchHistoriesForBackup() })
      if (result.cancelled) return
      toast.success('导出完成', {
        description: `VOD ${result.counts.vod}，直播 ${result.counts.live}，最近观看 ${result.counts.recent}，收藏 ${result.counts.favorites}`,
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
        description: `VOD ${result.counts.vod}，直播 ${result.counts.live}，最近观看 ${result.counts.recent}，收藏 ${result.counts.favorites}`,
      })
      window.setTimeout(() => window.location.reload(), 300)
    } catch (error) {
      toast.error('导入失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsImporting(false)
    }
  }

  return { isExporting, isImporting, isInitializing, exportData, importData, initializeData }
}
