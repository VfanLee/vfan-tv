import { useCallback, useEffect, useRef, useState } from 'react'
import { getIptvCatalog, listIptvSources, onAppDataChange } from '@/platform/api'
import type { IptvPlaylist, IptvSourceConfig } from '@/types'

export type CatalogRefreshStatus = 'idle' | 'background' | 'manual' | 'failed'

interface CatalogState {
  sourceId: string
  revision: number
  playlist?: IptvPlaylist
  loading: boolean
  status: CatalogRefreshStatus
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
  catalogRefreshStatus: CatalogRefreshStatus
  catalogError?: string
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
  const [catalog, setCatalog] = useState<CatalogState>({ sourceId: '', revision: 0, loading: false, status: 'idle' })
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

  /** 统一处理首次读取、过期缓存更新与手动刷新，并收尾最新请求的状态 */
  const loadCatalog = useCallback(
    async (force = false): Promise<RefreshResult> => {
      const request = ++catalogRequestIdRef.current
      /** 判断目录请求是否仍然有效 */
      const isCurrent = (): boolean => request === catalogRequestIdRef.current
      const previous =
        catalogRef.current.sourceId === availableSourceId && catalogRef.current.revision === revision
          ? catalogRef.current.playlist
          : undefined
      let next: CatalogState = {
        sourceId: availableSourceId,
        revision,
        playlist: previous,
        loading: Boolean(availableSourceId && !previous),
        status: force && availableSourceId ? 'manual' : 'idle',
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
        let result = await getIptvCatalog(availableSourceId, force)
        if (!isCurrent()) return
        next = { ...next, playlist: result, loading: false }
        if (!force && result.stale) {
          next = { ...next, status: 'background' }
          publish()
          result = await getIptvCatalog(availableSourceId, true)
          if (!isCurrent()) return
        }
        next = { ...next, playlist: result, status: 'idle' }
        return { status: 'success', previous, catalog: result }
      } catch (error) {
        if (!isCurrent()) return
        const message = toErrorMessage(error)
        next = { ...next, status: 'failed', error: message }
        return { status: 'failed', error: message, hasPrevious: Boolean(next.playlist) }
      } finally {
        next = { ...next, loading: false }
        publish()
      }
    },
    [availableSourceId, revision],
  )

  /** 为选中源加载频道，并使切源、配置变化或卸载前的请求失效 */
  useEffect(() => {
    void loadCatalog()
    return () => {
      catalogRequestIdRef.current += 1
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
    isLoadingCatalog: Boolean(availableSourceId && (!matchesSource || catalog.loading)),
    catalogRefreshStatus: matchesSource ? catalog.status : 'idle',
    catalogError: matchesSource ? catalog.error : undefined,
    refreshCatalog: () => loadCatalog(true),
  }
}

/** 将未知错误转换为可展示的错误消息 */
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
