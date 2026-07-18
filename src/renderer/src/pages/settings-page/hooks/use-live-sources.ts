import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { LiveSourceConfig } from '@shared/types'
import {
  clearLiveSources,
  deleteLiveSource,
  exportLiveSourcesToFile,
  importLiveSourcesFromFile,
  listLiveSources,
  reorderLiveSources,
  updateLiveSource,
} from '@renderer/services/api'
import { moveItemToEdge, toggleId } from '../utils'

export interface LiveSourcesState {
  allSelected: boolean
  enabledCount: number
  isBatchUpdating: boolean
  isClearing: boolean
  isReordering: boolean
  selectedSourceIds: Set<string>
  sources: LiveSourceConfig[]
  applySources: (sources: LiveSourceConfig[]) => void
  batchToggle: (enabled: boolean) => Promise<void>
  clearAll: () => Promise<void>
  deleteItem: (source: LiveSourceConfig) => Promise<void>
  exportItems: () => Promise<void>
  importItems: () => Promise<void>
  moveToEdge: (sourceId: string, edge: 'start' | 'end') => Promise<void>
  refresh: () => Promise<void>
  toggle: (source: LiveSourceConfig, enabled: boolean) => Promise<void>
  toggleAll: () => void
  toggleSelection: (sourceId: string) => void
}

export function useLiveSources(apiAvailable: boolean): LiveSourcesState {
  const [sources, setSources] = useState<LiveSourceConfig[]>([])
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(() => new Set())
  const [isBatchUpdating, setIsBatchUpdating] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [isReordering, setIsReordering] = useState(false)

  const applySources = useCallback((nextSources: LiveSourceConfig[]): void => {
    const sourceIds = new Set(nextSources.map((source) => source.id))
    setSources(nextSources)
    setSelectedSourceIds((current) => new Set([...current].filter((id) => sourceIds.has(id))))
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    applySources(await listLiveSources())
  }, [applySources])

  useEffect(() => {
    let active = true
    void listLiveSources().then((nextSources) => {
      if (active) applySources(nextSources)
    })
    return () => {
      active = false
    }
  }, [applySources])

  const importItems = async (): Promise<void> => {
    if (!apiAvailable) return
    try {
      const result = await importLiveSourcesFromFile()
      if (result.cancelled) return
      toast.success('导入完成', {
        description: `新增 ${result.created.length}，覆盖 ${result.overwritten.length}，跳过 ${result.skipped.length}`,
      })
      await refresh()
    } catch (error) {
      toast.error('导入失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  const exportItems = async (): Promise<void> => {
    if (!apiAvailable) return
    try {
      const result = await exportLiveSourcesToFile()
      if (result.cancelled) return
      toast.success('导出完成', { description: `已导出 ${result.count} 个直播源` })
    } catch (error) {
      toast.error('导出失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  const clearAll = async (): Promise<void> => {
    if (!apiAvailable || sources.length === 0) return
    setIsClearing(true)
    try {
      await clearLiveSources()
      applySources([])
      toast.success('已清空全部直播源')
    } catch (error) {
      toast.error('清空失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsClearing(false)
    }
  }

  const deleteItem = async (source: LiveSourceConfig): Promise<void> => {
    if (!apiAvailable) return
    try {
      await deleteLiveSource(source.id)
      toast.success('已删除直播源')
      await refresh()
    } catch (error) {
      toast.error('删除失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  const toggle = async (source: LiveSourceConfig, enabled: boolean): Promise<void> => {
    if (!apiAvailable) return
    const previousSources = sources
    setSources((current) => current.map((item) => (item.id === source.id ? { ...item, enabled } : item)))
    try {
      await updateLiveSource(source.id, { name: source.name, url: source.url, enabled })
    } catch (error) {
      setSources(previousSources)
      toast.error('状态更新失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  const allSelected = sources.length > 0 && selectedSourceIds.size === sources.length
  const toggleAll = (): void => {
    setSelectedSourceIds(allSelected ? new Set() : new Set(sources.map((source) => source.id)))
  }

  const batchToggle = async (enabled: boolean): Promise<void> => {
    const selectedSources = sources.filter((source) => selectedSourceIds.has(source.id))
    if (!apiAvailable || selectedSources.length === 0) return
    setIsBatchUpdating(true)
    setSources((current) =>
      current.map((source) => (selectedSourceIds.has(source.id) ? { ...source, enabled } : source)),
    )
    const results = await Promise.allSettled(
      selectedSources.map((source) => updateLiveSource(source.id, { name: source.name, url: source.url, enabled })),
    )
    const failedCount = results.filter((result) => result.status === 'rejected').length
    await refresh()
    setIsBatchUpdating(false)
    if (failedCount > 0)
      toast.error('部分状态更新失败', { description: `${failedCount} 个直播源未能更新，请稍后重试。` })
    else toast.success(`已${enabled ? '开启' : '关闭'} ${selectedSources.length} 个直播源`)
  }

  const moveToEdge = async (sourceId: string, edge: 'start' | 'end'): Promise<void> => {
    if (!apiAvailable || isReordering) return
    const nextSources = moveItemToEdge(sources, sourceId, edge)
    if (!nextSources) return
    const previousSources = sources
    setSources(nextSources)
    setIsReordering(true)
    try {
      applySources(await reorderLiveSources(nextSources.map((source) => source.id)))
    } catch (error) {
      setSources(previousSources)
      toast.error('排序保存失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsReordering(false)
    }
  }

  return {
    allSelected,
    enabledCount: sources.filter((source) => source.enabled).length,
    isBatchUpdating,
    isClearing,
    isReordering,
    selectedSourceIds,
    sources,
    applySources,
    batchToggle,
    clearAll,
    deleteItem,
    exportItems,
    importItems,
    moveToEdge,
    refresh,
    toggle,
    toggleAll,
    toggleSelection: (sourceId) => setSelectedSourceIds((current) => toggleId(current, sourceId)),
  }
}
