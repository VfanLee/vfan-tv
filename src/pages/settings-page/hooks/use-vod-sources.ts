import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { mapAsync } from 'es-toolkit/array'
import type { VodSourceConfig } from '@/types'
import {
  clearSources,
  deleteSource,
  exportSourcesToFile,
  importSourcesFromFile,
  listSources,
  reorderSources,
  switchSourceBackup,
  testSourceSpeed,
  updateSource,
} from '@/platform/api'
import type { VodSourceSpeedState } from '../types'
import { useSourceManagement, type SourceAdapter, type SourceManagementState } from './use-source-management'

/** 点播源测速任务的最大并发数 */
const SPEED_TEST_CONCURRENCY = 6

export interface VodSourcesState extends SourceManagementState<VodSourceConfig> {
  isTestingAll: boolean
  speedResults: Record<string, VodSourceSpeedState>
  switchBackup: (source: VodSourceConfig, backupUrl: string) => Promise<void>
  testAll: () => Promise<void>
  testSingle: (sourceId: string) => Promise<void>
}

/** 点播源的读取、交换和状态更新接口 */
const adapter: SourceAdapter<VodSourceConfig> = {
  label: '点播源',
  list: listSources,
  clear: clearSources,
  delete: deleteSource,
  reorder: reorderSources,
  import: importSourcesFromFile,
  export: exportSourcesToFile,
  /** 保留备用地址和请求头，仅改变禁用状态 */
  setDisabled: (source, disabled) =>
    updateSource(source.id, {
      name: source.name,
      url: source.url,
      headers: source.headers,
      backups: source.backups,
      disabled,
    }),
}

/** 加载点播源，并提供导入、导出、测速、禁用、删除和排序操作 */
export function useVodSources(apiAvailable: boolean): VodSourcesState {
  const [isTestingAll, setIsTestingAll] = useState(false)
  const [speedResults, setSpeedResults] = useState<Record<string, VodSourceSpeedState>>({})

  /** 清理已删除源的测速结果 */
  const pruneSpeedResults = useCallback((nextSources: VodSourceConfig[]): void => {
    const sourceIds = new Set(nextSources.map((source) => source.id))
    setSpeedResults((current) => Object.fromEntries(Object.entries(current).filter(([id]) => sourceIds.has(id))))
  }, [])
  const management = useSourceManagement(apiAvailable, adapter, pruneSpeedResults)
  const { sources, replaceSource } = management

  /** 切换备用源 */
  const switchBackup = async (source: VodSourceConfig, backupUrl: string): Promise<void> => {
    if (!apiAvailable) return
    try {
      const updated = await switchSourceBackup(source.id, backupUrl)
      replaceSource(updated)
      setSpeedResults((current) => {
        const next = { ...current }
        delete next[source.id]
        return next
      })
      toast.success('已切换地址', { description: updated.url })
    } catch (error) {
      toast.error('切换地址失败', { description: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  /** 测试单个点播源的连接速度 */
  const testSingle = async (sourceId: string): Promise<void> => {
    if (!apiAvailable) return
    setSpeedResults((current) => ({ ...current, [sourceId]: { status: 'testing' } }))
    try {
      const result = await testSourceSpeed(sourceId)
      setSpeedResults((current) => ({ ...current, [sourceId]: result }))
    } catch (error) {
      setSpeedResults((current) => ({
        ...current,
        [sourceId]: { status: 'error', errorMessage: error instanceof Error ? error.message : '测速失败' },
      }))
    }
  }

  /** 测试所有点播源的连接速度 */
  const testAll = async (): Promise<void> => {
    if (!apiAvailable || sources.length === 0 || isTestingAll) return
    setIsTestingAll(true)
    setSpeedResults(
      Object.fromEntries(sources.map((source) => [source.id, { status: 'testing' } satisfies VodSourceSpeedState])),
    )
    try {
      await mapAsync(sources, (source) => testSingle(source.id), { concurrency: SPEED_TEST_CONCURRENCY })
      toast.success('测速完成')
    } finally {
      setIsTestingAll(false)
    }
  }

  return { ...management, isTestingAll, speedResults, switchBackup, testAll, testSingle }
}
