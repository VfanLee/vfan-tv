import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { VodSourceConfig } from '@shared/types'
import {
  clearSources,
  deleteSource,
  exportSourcesToFile,
  importSourcesFromFile,
  listSources,
  reorderSources,
  switchSourceBackup,
  updateSource,
} from '@renderer/services/api'
import { moveItem, toggleId } from '../utils'

export interface VodSourcesState {
  allSelected: boolean
  draggedSourceId?: string
  dragOverSourceId?: string
  enabledCount: number
  isBatchUpdating: boolean
  isClearing: boolean
  isReordering: boolean
  selectedSourceIds: Set<string>
  sources: VodSourceConfig[]
  applySources: (sources: VodSourceConfig[]) => void
  batchToggle: (enabled: boolean) => Promise<void>
  clearAll: () => Promise<void>
  deleteItem: (source: VodSourceConfig) => Promise<void>
  drop: (targetSourceId: string) => Promise<void>
  exportItems: () => Promise<void>
  importItems: () => Promise<void>
  refresh: () => Promise<void>
  resetDrag: () => void
  setDraggedSourceId: (sourceId: string | undefined) => void
  setDragOverSourceId: (sourceId: string | undefined) => void
  switchBackup: (source: VodSourceConfig, backupUrl: string) => Promise<void>
  toggle: (source: VodSourceConfig, enabled: boolean) => Promise<void>
  toggleAll: () => void
  toggleSelection: (sourceId: string) => void
}

export function useVodSources(apiAvailable: boolean): VodSourcesState {
  const [sources, setSources] = useState<VodSourceConfig[]>([])
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(() => new Set())
  const [isBatchUpdating, setIsBatchUpdating] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [draggedSourceId, setDraggedSourceId] = useState<string>()
  const [dragOverSourceId, setDragOverSourceId] = useState<string>()
  const [isReordering, setIsReordering] = useState(false)

  const applySources = useCallback((nextSources: VodSourceConfig[]): void => {
    const sourceIds = new Set(nextSources.map((source) => source.id))
    setSources(nextSources)
    setSelectedSourceIds((current) => new Set([...current].filter((id) => sourceIds.has(id))))
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    applySources(await listSources())
  }, [applySources])

  useEffect(() => {
    let active = true
    void listSources().then((nextSources) => {
      if (active) applySources(nextSources)
    })
    return () => {
      active = false
    }
  }, [applySources])

  const importItems = async (): Promise<void> => {
    if (!apiAvailable) return
    try {
      const result = await importSourcesFromFile()
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
      const result = await exportSourcesToFile()
      if (result.cancelled) return
      toast.success('导出完成', { description: `已导出 ${result.count} 个点播源` })
    } catch (error) {
      toast.error('导出失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  const clearAll = async (): Promise<void> => {
    if (!apiAvailable || sources.length === 0) return
    setIsClearing(true)
    try {
      await clearSources()
      applySources([])
      toast.success('已清空全部点播源')
    } catch (error) {
      toast.error('清空失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsClearing(false)
    }
  }

  const deleteItem = async (source: VodSourceConfig): Promise<void> => {
    if (!apiAvailable) return
    try {
      await deleteSource(source.id)
      toast.success('已删除点播源')
      await refresh()
    } catch (error) {
      toast.error('删除失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  const toggle = async (source: VodSourceConfig, enabled: boolean): Promise<void> => {
    if (!apiAvailable) return
    const previousSources = sources
    setSources((current) => current.map((item) => (item.id === source.id ? { ...item, enabled } : item)))
    try {
      await updateSource(source.id, {
        name: source.name,
        url: source.url,
        referer: source.referer,
        enabled,
        backups: source.backups,
      })
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
      selectedSources.map((source) =>
        updateSource(source.id, {
          name: source.name,
          url: source.url,
          referer: source.referer,
          enabled,
          backups: source.backups,
        }),
      ),
    )
    const failedCount = results.filter((result) => result.status === 'rejected').length
    await refresh()
    setIsBatchUpdating(false)
    if (failedCount > 0) {
      toast.error('部分状态更新失败', { description: `${failedCount} 个点播源未能更新，请稍后重试。` })
    } else {
      toast.success(`已${enabled ? '开启' : '关闭'} ${selectedSources.length} 个点播源`)
    }
  }

  const resetDrag = (): void => {
    setDraggedSourceId(undefined)
    setDragOverSourceId(undefined)
  }

  const switchBackup = async (source: VodSourceConfig, backupUrl: string): Promise<void> => {
    if (!apiAvailable) return
    try {
      const updated = await switchSourceBackup(source.id, backupUrl)
      setSources((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      toast.success('已切换地址', { description: updated.url })
    } catch (error) {
      toast.error('切换地址失败', { description: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  const drop = async (targetSourceId: string): Promise<void> => {
    const activeSourceId = draggedSourceId
    resetDrag()
    if (!activeSourceId || activeSourceId === targetSourceId) return
    const nextSources = moveItem(sources, activeSourceId, targetSourceId)
    if (!nextSources) return
    const previousSources = sources
    setSources(nextSources)
    setIsReordering(true)
    try {
      applySources(await reorderSources(nextSources.map((source) => source.id)))
    } catch (error) {
      setSources(previousSources)
      toast.error('排序保存失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsReordering(false)
    }
  }

  return {
    allSelected,
    draggedSourceId,
    dragOverSourceId,
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
    drop,
    exportItems,
    importItems,
    refresh,
    resetDrag,
    setDraggedSourceId,
    setDragOverSourceId,
    switchBackup,
    toggle,
    toggleAll,
    toggleSelection: (sourceId) => setSelectedSourceIds((current) => toggleId(current, sourceId)),
  }
}
