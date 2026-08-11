import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { IptvSourceConfig } from '@shared/types'
import {
  clearIptvSources,
  deleteIptvSource,
  exportIptvSourcesToFile,
  importIptvSourcesFromFile,
  listIptvSources,
  reorderIptvSources,
  updateIptvSource,
} from '@renderer/platform/api'
import { moveItemToEdge, toggleId } from '../utils'

export interface IptvSourcesState {
  allSelected: boolean
  enabledCount: number
  isBatchUpdating: boolean
  isClearing: boolean
  isReordering: boolean
  selectedSourceIds: Set<string>
  sources: IptvSourceConfig[]
  applySources: (sources: IptvSourceConfig[]) => void
  batchSetDisabled: (disabled: boolean) => Promise<void>
  clearAll: () => Promise<void>
  deleteItem: (source: IptvSourceConfig) => Promise<void>
  exportItems: () => Promise<void>
  importItems: () => Promise<void>
  moveToEdge: (sourceId: string, edge: 'start' | 'end') => Promise<void>
  refresh: () => Promise<void>
  setDisabled: (source: IptvSourceConfig, disabled: boolean) => Promise<void>
  toggleAll: () => void
  toggleSelection: (sourceId: string) => void
}

/** 加载 IPTV 源，并提供导入、导出、禁用、删除和排序操作 */
export function useIptvSources(apiAvailable: boolean): IptvSourcesState {
  const [sources, setSources] = useState<IptvSourceConfig[]>([])
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(() => new Set())
  const [isBatchUpdating, setIsBatchUpdating] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [isReordering, setIsReordering] = useState(false)

  /** 用最新 IPTV 源列表更新页面状态和已选项 */
  const applySources = useCallback((nextSources: IptvSourceConfig[]): void => {
    const sourceIds = new Set(nextSources.map((source) => source.id))
    setSources(nextSources)
    setSelectedSourceIds((current) => new Set([...current].filter((id) => sourceIds.has(id))))
  }, [])

  /** 重新加载 IPTV 源列表 */
  const refresh = useCallback(async (): Promise<void> => {
    applySources(await listIptvSources())
  }, [applySources])

  /** 加载 IPTV 源列表 */
  useEffect(() => {
    let active = true
    void listIptvSources().then((nextSources) => {
      if (active) applySources(nextSources)
    })
    return () => {
      active = false
    }
  }, [applySources])

  /** 从文件导入 IPTV 源并刷新列表 */
  const importItems = async (): Promise<void> => {
    if (!apiAvailable) return
    try {
      const result = await importIptvSourcesFromFile()
      if (result.cancelled) return
      toast.success('导入完成', {
        description: `新增 ${result.created.length}，覆盖 ${result.overwritten.length}，跳过 ${result.skipped.length}`,
      })
      await refresh()
    } catch (error) {
      toast.error('导入失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  /** 将全部 IPTV 源导出到文件 */
  const exportItems = async (): Promise<void> => {
    if (!apiAvailable) return
    try {
      const result = await exportIptvSourcesToFile()
      if (result.cancelled) return
      toast.success('导出完成', { description: `已导出 ${result.count} 个 IPTV 源` })
    } catch (error) {
      toast.error('导出失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  /** 删除全部 IPTV 源并清空页面状态 */
  const clearAll = async (): Promise<void> => {
    if (!apiAvailable || sources.length === 0) return
    setIsClearing(true)
    try {
      await clearIptvSources()
      applySources([])
      toast.success('已清空全部 IPTV 源')
    } catch (error) {
      toast.error('清空失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsClearing(false)
    }
  }

  /** 删除指定数据项 */
  const deleteItem = async (source: IptvSourceConfig): Promise<void> => {
    if (!apiAvailable) return
    try {
      await deleteIptvSource(source.id)
      toast.success('已删除 IPTV 源')
      await refresh()
    } catch (error) {
      toast.error('删除失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  /** 设置指定数据项的禁用状态 */
  const setDisabled = async (source: IptvSourceConfig, disabled: boolean): Promise<void> => {
    if (!apiAvailable) return
    const previousSources = sources
    setSources((current) => current.map((item) => (item.id === source.id ? { ...item, disabled } : item)))
    try {
      await updateIptvSource(source.id, {
        name: source.name,
        url: source.url,
        disabled,
        headers: source.headers,
      })
    } catch (error) {
      setSources(previousSources)
      toast.error('状态更新失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  const allSelected = sources.length > 0 && selectedSourceIds.size === sources.length
  /** 全选或清空当前 IPTV 源选择 */
  const toggleAll = (): void => {
    setSelectedSourceIds(allSelected ? new Set() : new Set(sources.map((source) => source.id)))
  }

  /** 批量设置数据项的禁用状态 */
  const batchSetDisabled = async (disabled: boolean): Promise<void> => {
    const selectedSources = sources.filter((source) => selectedSourceIds.has(source.id))
    if (!apiAvailable || selectedSources.length === 0) return
    setIsBatchUpdating(true)
    setSources((current) =>
      current.map((source) => (selectedSourceIds.has(source.id) ? { ...source, disabled } : source)),
    )
    const results = await Promise.allSettled(
      selectedSources.map((source) =>
        updateIptvSource(source.id, {
          name: source.name,
          url: source.url,
          disabled,
          headers: source.headers,
        }),
      ),
    )
    const failedCount = results.filter((result) => result.status === 'rejected').length
    await refresh()
    setIsBatchUpdating(false)
    if (failedCount > 0)
      toast.error('部分状态更新失败', { description: `${failedCount} 个 IPTV 源未能更新，请稍后重试。` })
    else toast.success(`已${disabled ? '关闭' : '开启'} ${selectedSources.length} 个 IPTV 源`)
  }

  /** 将选中项移动到列表边缘 */
  const moveToEdge = async (sourceId: string, edge: 'start' | 'end'): Promise<void> => {
    if (!apiAvailable || isReordering) return
    const nextSources = moveItemToEdge(sources, sourceId, edge)
    if (!nextSources) return
    const previousSources = sources
    setSources(nextSources)
    setIsReordering(true)
    try {
      applySources(await reorderIptvSources(nextSources.map((source) => source.id)))
    } catch (error) {
      setSources(previousSources)
      toast.error('排序保存失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsReordering(false)
    }
  }

  return {
    allSelected,
    enabledCount: sources.filter((source) => !source.disabled).length,
    isBatchUpdating,
    isClearing,
    isReordering,
    selectedSourceIds,
    sources,
    applySources,
    batchSetDisabled,
    clearAll,
    deleteItem,
    exportItems,
    importItems,
    moveToEdge,
    refresh,
    setDisabled,
    toggleAll,
    toggleSelection: (sourceId) => setSelectedSourceIds((current) => toggleId(current, sourceId)),
  }
}
