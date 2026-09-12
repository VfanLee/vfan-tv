import { useCallback, useEffect, useRef, useState } from 'react'
import { getIptvCatalog, listIptvSources, onAppDataChange } from '@/platform/api'
import type { IptvPlaylist, IptvSourceConfig } from '@/types'

/** 频道目录的单一请求状态，是否显示全屏加载由已有频道决定 */
export type CatalogStatus = 'idle' | 'loading' | 'refreshing' | 'ready' | 'error'
/** 读取允许使用缓存，更新要求取得源站最新数据 */
type CatalogMode = 'load' | 'refresh'
type CatalogAction = CatalogMode | 'retry'

interface CatalogState {
  sourceId: string
  revision: number
  playlist?: IptvPlaylist
  status: CatalogStatus
  mode: CatalogMode
  error?: string
}

type RefreshResult =
  | { status: 'success'; previous?: IptvPlaylist; catalog: IptvPlaylist }
  | { status: 'failed'; error: string; hasPrevious: boolean }
  | undefined

interface IptvCatalogState {
  sources: IptvSourceConfig[]
  sourceId: string
  source?: IptvSourceConfig
  selectSource: (id: string) => void
  isLoadingSources: boolean
  sourcesError?: string
  retrySources: () => void
  playlist?: IptvPlaylist
  isLoadingCatalog: boolean
  catalogStatus: CatalogStatus
  catalogError?: string
  retryCatalog: () => Promise<RefreshResult>
  refreshCatalog: () => Promise<RefreshResult>
}

/** 分别管理源列表与频道请求，只接收当前源的最新请求结果 */
export function useIptvCatalog(initialSourceId: string): IptvCatalogState {
  const [sources, setSources] = useState<IptvSourceConfig[]>([])
  const [sourceId, setSourceId] = useState(initialSourceId)
  const [isLoadingSources, setIsLoadingSources] = useState(true)
  const [sourcesError, setSourcesError] = useState<string>()
  const [sourcesRetry, setSourcesRetry] = useState(0)
  const [revision, setRevision] = useState(0)
  const [catalog, setCatalog] = useState<CatalogState>({ sourceId: '', revision: 0, status: 'idle', mode: 'load' })
  const catalogRef = useRef(catalog)
  const catalogRequestIdRef = useRef(0)
  const source = sources.find((item) => item.id === sourceId)
  /** 仅为已经确认存在且启用的源加载目录 */
  const availableSourceId = source?.id ?? ''
  /** 切源或源配置变化时立即隐藏旧目录与旧错误 */
  const matchesSource = catalog.sourceId === availableSourceId && catalog.revision === revision

  /** 读取源列表并订阅配置变化，隔离并发源请求与卸载后的结果 */
  useEffect(() => {
    let active = true
    let latestRequest = 0
    /** 读取最新源配置并保留仍然有效的选择 */
    const loadSources = async (invalidateCatalog = false): Promise<void> => {
      const request = ++latestRequest
      /** 判断源请求是否仍然有效 */
      const isCurrent = (): boolean => active && request === latestRequest
      setIsLoadingSources(true)
      setSourcesError(undefined)
      try {
        const items = await listIptvSources()
        if (!isCurrent()) return
        const available = items.filter((item) => !item.disabled)
        setSources(available)
        setSourceId((current) => (available.some((item) => item.id === current) ? current : (available[0]?.id ?? '')))
        if (invalidateCatalog) setRevision((value) => value + 1)
      } catch (error) {
        if (isCurrent()) setSourcesError(toErrorMessage(error))
      } finally {
        if (isCurrent()) setIsLoadingSources(false)
      }
    }
    void loadSources(sourcesRetry > 0)
    const unsubscribe = onAppDataChange((domain) => {
      if (domain === 'iptv-sources' || domain === 'app-data') void loadSources(true)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [sourcesRetry])

  /** 统一执行读取、更新与失败重试，同一源正在加载时忽略重复入口操作 */
  const loadCatalog = useCallback(
    async (action: CatalogAction): Promise<RefreshResult> => {
      const current = catalogRef.current
      const sameSource = current.sourceId === availableSourceId && current.revision === revision
      const mode = action === 'retry' ? (sameSource ? current.mode : 'load') : action
      if (sameSource && (current.status === 'loading' || current.status === 'refreshing')) return
      const request = ++catalogRequestIdRef.current
      /** 判断目录请求是否仍然有效 */
      const isCurrent = (): boolean => request === catalogRequestIdRef.current
      const previous = sameSource ? current.playlist : undefined
      let next: CatalogState = {
        sourceId: availableSourceId,
        revision,
        playlist: previous,
        status: !availableSourceId ? 'idle' : mode === 'refresh' ? 'refreshing' : 'loading',
        mode,
      }
      /** 发布当前请求的目录与状态快照 */
      const publish = (): void => {
        if (!isCurrent()) return
        catalogRef.current = next
        setCatalog(next)
      }
      publish()
      if (!availableSourceId) return
      try {
        let result = await requestCatalog(availableSourceId, mode, isCurrent)
        if (!isCurrent() || !result) return
        next = { ...next, playlist: result }
        if (mode === 'load' && result.stale) {
          next = { ...next, mode: 'refresh', status: 'refreshing' }
          publish()
          result = await requestCatalog(availableSourceId, 'refresh', isCurrent)
          if (!isCurrent() || !result) return
        }
        next = { ...next, playlist: result, status: 'ready' }
        return { status: 'success', previous, catalog: result }
      } catch (error) {
        if (!isCurrent()) return
        const message = toErrorMessage(error)
        next = { ...next, status: 'error', error: message }
        return { status: 'failed', error: message, hasPrevious: Boolean(next.playlist) }
      } finally {
        publish()
      }
    },
    [availableSourceId, revision],
  )

  /** 为选中源加载频道，并使切源、配置变化或卸载前的请求失效 */
  useEffect(() => {
    void loadCatalog('load')
    return () => {
      catalogRequestIdRef.current += 1
      // 释放进行中标记，使 React 重挂载 effect 时可以重新读取。
      catalogRef.current = { ...catalogRef.current, status: 'idle' }
    }
  }, [loadCatalog])

  /** 切换源时立即使旧请求失效，重复选择当前源不清空目录 */
  const selectSource = (id: string): void => {
    if (id === sourceId) return
    catalogRequestIdRef.current += 1
    setSourceId(id)
  }

  return {
    sources,
    sourceId,
    source,
    selectSource,
    isLoadingSources,
    sourcesError,
    retrySources: () => setSourcesRetry((value) => value + 1),
    playlist: matchesSource ? catalog.playlist : undefined,
    isLoadingCatalog: Boolean(
      availableSourceId &&
      (!matchesSource || (!catalog.playlist && (catalog.status === 'loading' || catalog.status === 'refreshing'))),
    ),
    catalogStatus: matchesSource ? catalog.status : 'idle',
    catalogError: matchesSource ? catalog.error : undefined,
    retryCatalog: () => loadCatalog('retry'),
    refreshCatalog: () => loadCatalog('refresh'),
  }
}

/** 按统一策略执行目录请求；超时仅补试一次，失效请求不再发起或返回结果 */
async function requestCatalog(
  sourceId: string,
  mode: CatalogMode,
  isCurrent: () => boolean,
): Promise<IptvPlaylist | undefined> {
  for (let attempt = 0; attempt < 2 && isCurrent(); attempt += 1) {
    try {
      return await getIptvCatalog(sourceId, mode === 'refresh')
    } catch (error) {
      if (!isCurrent()) return
      const timedOut = ['网络请求超时', '直播目录请求超时'].includes(toErrorMessage(error))
      if (!timedOut || attempt > 0) throw error
    }
  }
  return undefined
}

/** 将未知错误转换为可展示的错误消息 */
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
