import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { IptvSourceConfig } from '@/types'
import type { exportIptvSourcesToFile, importIptvSourcesFromFile } from '@/platform/api'
import { moveItemToEdge, toggleId } from '../utils'

/** 源管理操作所需的公共字段 */
type ManagedSource = Pick<IptvSourceConfig, 'id' | 'disabled'>

/** 为两类源提供各自的 API 与展示名称 */
export interface SourceAdapter<T extends ManagedSource> {
  label: string
  list: () => Promise<T[]>
  clear: () => Promise<unknown>
  delete: (id: string) => Promise<unknown>
  reorder: (ids: string[]) => Promise<T[]>
  setDisabled: (source: T, disabled: boolean) => Promise<unknown>
  import: typeof importIptvSourcesFromFile
  export: typeof exportIptvSourcesToFile
}

export interface SourceManagementState<T extends ManagedSource> {
  allSelected: boolean
  enabledCount: number
  isBatchUpdating: boolean
  isClearing: boolean
  isReordering: boolean
  selectedSourceIds: Set<string>
  sources: T[]
  applySources: (sources: T[]) => void
  replaceSource: (source: T) => void
  batchSetDisabled: (disabled: boolean) => Promise<void>
  clearAll: () => Promise<void>
  deleteItem: (source: T) => Promise<void>
  exportItems: () => Promise<void>
  importItems: () => Promise<void>
  moveToEdge: (sourceId: string, edge: 'start' | 'end') => Promise<void>
  refresh: () => Promise<void>
  setDisabled: (source: T, disabled: boolean) => Promise<void>
  toggleAll: () => void
  toggleSelection: (sourceId: string) => void
}

/** 管理两类源共用的列表、选择、导入导出和修改状态 */
export function useSourceManagement<T extends ManagedSource>(
  apiAvailable: boolean,
  adapter: SourceAdapter<T>,
  onApply?: (sources: T[]) => void,
): SourceManagementState<T> {
  const { label } = adapter
  const [sources, setSources] = useState<T[]>([])
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(() => new Set())
  const [isBatchUpdating, setIsBatchUpdating] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [isReordering, setIsReordering] = useState(false)

  /** 用最新源列表更新页面状态和已选项 */
  const applySources = useCallback(
    (nextSources: T[]): void => {
      const sourceIds = new Set(nextSources.map((source) => source.id))
      onApply?.(nextSources)
      setSources(nextSources)
      setSelectedSourceIds((current) => new Set([...current].filter((id) => sourceIds.has(id))))
    },
    [onApply],
  )

  /** 重新加载当前类别的源列表 */
  const refresh = useCallback(async (): Promise<void> => {
    applySources(await adapter.list())
  }, [adapter, applySources])

  /** 加载源列表并忽略组件卸载后的响应 */
  useEffect(() => {
    let active = true
    void adapter
      .list()
      .then((nextSources) => {
        if (active) applySources(nextSources)
      })
      .catch((error: unknown) => {
        if (active) toast.error('加载源失败', { description: String(error) })
      })
    return () => {
      active = false
    }
  }, [adapter, applySources])

  /** 从文件导入当前类别的源并刷新列表 */
  const importItems = async (): Promise<void> => {
    if (!apiAvailable) return
    try {
      const result = await adapter.import()
      if (result.cancelled) return
      toast.success('导入完成', {
        description: `新增 ${result.created.length}，覆盖 ${result.overwritten.length}，跳过 ${result.skipped.length}`,
      })
      await refresh()
    } catch (error) {
      toast.error('导入失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  /** 将当前类别的全部源导出到文件 */
  const exportItems = async (): Promise<void> => {
    if (!apiAvailable) return
    try {
      const result = await adapter.export()
      if (result.cancelled) return
      toast.success('导出完成', { description: `已导出 ${result.count} 个 ${label}` })
    } catch (error) {
      toast.error('导出失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  /** 删除当前类别的全部源并清空页面状态 */
  const clearAll = async (): Promise<void> => {
    if (!apiAvailable || sources.length === 0) return
    setIsClearing(true)
    try {
      await adapter.clear()
      applySources([])
      toast.success(`已清空全部 ${label}`)
    } catch (error) {
      toast.error('清空失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setIsClearing(false)
    }
  }

  /** 删除指定数据项 */
  const deleteItem = async (source: T): Promise<void> => {
    if (!apiAvailable) return
    try {
      await adapter.delete(source.id)
      toast.success(`已删除 ${label}`)
      await refresh()
    } catch (error) {
      toast.error('删除失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  /** 设置指定数据项的禁用状态 */
  const setDisabled = async (source: T, disabled: boolean): Promise<void> => {
    if (!apiAvailable) return
    const previousSources = sources
    setSources((current) => current.map((item) => (item.id === source.id ? { ...item, disabled } : item)))
    try {
      await adapter.setDisabled(source, disabled)
    } catch (error) {
      setSources(previousSources)
      toast.error('状态更新失败', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  const allSelected = sources.length > 0 && selectedSourceIds.size === sources.length
  /** 全选或清空当前源列表的选择 */
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
    try {
      const results = await Promise.allSettled(selectedSources.map((source) => adapter.setDisabled(source, disabled)))
      const failedCount = results.filter((result) => result.status === 'rejected').length
      await refresh()
      if (failedCount > 0)
        toast.error('部分状态更新失败', { description: `${failedCount} 个 ${label}未能更新，请稍后重试。` })
      else toast.success(`已${disabled ? '关闭' : '开启'} ${selectedSources.length} 个 ${label}`)
    } catch (error) {
      toast.error('刷新源状态失败', { description: String(error) })
    } finally {
      setIsBatchUpdating(false)
    }
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
      applySources(await adapter.reorder(nextSources.map((source) => source.id)))
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
    replaceSource: (source) => setSources((current) => current.map((item) => (item.id === source.id ? source : item))),
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
