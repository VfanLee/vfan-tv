import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { VodCatalogCategory, VodCatalogPage, VodSearchResult, VodSourceConfig } from '@/types'
import { listSources, onAppDataChange, switchSourceBackup } from '@/platform/api'
import {
  fetchVodCatalogPage,
  getVodCatalogCacheRevision,
  getVodCatalogContextKey,
  getVodCatalogSourceKey,
  isRecommendationCacheExpired,
  pruneVodCatalogPages,
  readVodCatalogContext,
  readVodCatalogPage,
  subscribeVodCatalogInvalidation,
} from '@/platform/cache/recommendation-cache'
import {
  pruneVodCategoryCache,
  readCachedVodCategories,
  writeCachedVodCategories,
} from '@/platform/cache/vod-catalog-categories'

interface CatalogPageState {
  categories: VodCatalogCategory[]
  errorMessage: string
  isLoading: boolean
  isRefreshing: boolean
  items: VodSearchResult[]
  page: number
  pageCount: number
  redirectPage: number | null
  total: number
}

interface PageSnapshot {
  fingerprint: string
  state: CatalogPageState
}

/** 空白资源目录分页状态 */
const emptyPageState: CatalogPageState = {
  categories: [],
  errorMessage: '',
  isLoading: false,
  isRefreshing: false,
  items: [],
  page: 0,
  pageCount: 0,
  redirectPage: null,
  total: 0,
}

/** 加载已启用的点播源，并提供备用地址切换操作 */
export function useEnabledVodSources(): {
  errorMessage: string
  isLoading: boolean
  sources: VodSourceConfig[]
  switchBackup: (sourceId: string, backupUrl: string) => Promise<VodSourceConfig>
} {
  const [sources, setSources] = useState<VodSourceConfig[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  /** 加载已启用点播源并订阅源数据变化 */
  useEffect(() => {
    let active = true
    let requestId = 0
    /** 重新加载已启用的点播源 */
    const refresh = (): void => {
      const request = ++requestId
      void listSources()
        .then((items) => {
          if (!active || request !== requestId) return
          pruneVodCategoryCache(items)
          pruneVodCatalogPages(items)
          setSources(items.filter((item) => !item.disabled))
          setErrorMessage('')
        })
        .catch((error: unknown) => {
          if (active && request === requestId) setErrorMessage(toErrorMessage(error))
        })
        .finally(() => {
          if (active && request === requestId) setIsLoading(false)
        })
    }
    refresh()
    const unsubscribe = onAppDataChange((domain) => {
      if (domain === 'vod-sources' || domain === 'app-data') refresh()
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  /** 切换备用源 */
  const switchBackup = useCallback(async (sourceId: string, backupUrl: string): Promise<VodSourceConfig> => {
    const updated = await switchSourceBackup(sourceId, backupUrl)
    setSources((current) => current.map((source) => (source.id === updated.id ? updated : source)))
    return updated
  }, [])

  return { errorMessage, isLoading, sources, switchBackup }
}

/** 加载点播资源目录，并维护分类、分页、加载和错误状态 */
export function useVodCatalog({
  categoryId,
  keyword,
  page,
  source,
}: {
  categoryId?: string
  keyword?: string
  page: number
  source?: VodSourceConfig
}): CatalogPageState & { retry: () => Promise<void> } {
  const [state, setState] = useState<CatalogPageState>(emptyPageState)
  const sourceKey = source ? getVodCatalogSourceKey(source) : ''
  /** 标识当前点播源、分类和关键词的分页上下文键 */
  const paginationContextKey = source ? getVodCatalogContextKey(source, categoryId, keyword) : ''
  const requestIdRef = useRef(0)
  const sourceRef = useRef(source)
  sourceRef.current = source
  const [cacheRevision, setCacheRevision] = useState(getVodCatalogCacheRevision)
  const activeSourceKeyRef = useRef(sourceKey)
  const paginationContextKeyRef = useRef('')
  const appliedCacheRevisionRef = useRef(cacheRevision)
  const pageCountCeilingRef = useRef<number | null>(null)
  const pageSnapshotsRef = useRef(new Map<number, PageSnapshot>())
  const unsupportedPaginationRef = useRef(false)
  const stateRef = useRef(state)
  stateRef.current = state

  /** 监听跨页面缓存清理，清理后重新请求当前目录 */
  useEffect(() => subscribeVodCatalogInvalidation(() => setCacheRevision(getVodCatalogCacheRevision())), [])

  /** 读取当前页缓存或联网更新，统一执行分页校正并隔离迟到结果 */
  const requestPage = useCallback(
    async (force = false): Promise<void> => {
      const source = sourceRef.current
      if (!source) return
      const requestId = ++requestIdRef.current
      const revision = getVodCatalogCacheRevision()
      /** 判断结果是否仍属于当前页面与缓存版本 */
      const isCurrent = (): boolean => requestIdRef.current === requestId && revision === getVodCatalogCacheRevision()
      const cached = readVodCatalogPage(paginationContextKey, page)
      const needsUpdate = force || !cached || isRecommendationCacheExpired(cached.fetchedAt)
      for (const snapshotPage of pageSnapshotsRef.current.keys()) {
        const entry = readVodCatalogPage(paginationContextKey, snapshotPage)
        if (!entry || isRecommendationCacheExpired(entry.fetchedAt)) {
          pageSnapshotsRef.current.delete(snapshotPage)
          pageCountCeilingRef.current = null
          unsupportedPaginationRef.current = false
        }
      }
      /** 将服务端或缓存分页转换为已校正的页面状态 */
      const applyResult = (result: VodCatalogPage): CatalogPageState => {
        if (result.categories.length > 0) writeCachedVodCategories(source, result.categories)
        const categories = result.categories.length > 0 ? result.categories : readCachedVodCategories(source)
        const fallbackSnapshot = getPreviousSnapshot(pageSnapshotsRef.current, page)

        if (page > 1 && result.items.length === 0) {
          pageCountCeilingRef.current = fallbackSnapshot?.state.page ?? 1
          if (fallbackSnapshot) {
            return {
              ...fallbackSnapshot.state,
              categories,
              errorMessage: '',
              isLoading: false,
              isRefreshing: false,
              pageCount: fallbackSnapshot.state.page,
              redirectPage: fallbackSnapshot.state.page,
            }
          } else {
            return { ...emptyPageState, categories, redirectPage: 1 }
          }
        }

        const fingerprint = createPageFingerprint(result.items)
        const duplicateSnapshot = findDuplicateSnapshot(pageSnapshotsRef.current, page, fingerprint)
        if (page > 1 && duplicateSnapshot) {
          const otherPages = [...pageSnapshotsRef.current.keys()].filter((snapshotPage) => snapshotPage !== page)
          const onlyFirstPageKnown = otherPages.length === 1 && otherPages[0] === 1
          if (!onlyFirstPageKnown) {
            pageCountCeilingRef.current = page - 1
            const previousSnapshot = getPreviousSnapshot(pageSnapshotsRef.current, page) ?? duplicateSnapshot
            return {
              ...previousSnapshot.state,
              categories,
              errorMessage: '',
              isLoading: false,
              isRefreshing: false,
              pageCount: Math.min(previousSnapshot.state.pageCount, page - 1),
              redirectPage: previousSnapshot.state.page,
            }
          }

          unsupportedPaginationRef.current = true
          const firstSnapshot = pageSnapshotsRef.current.get(1) ?? duplicateSnapshot
          const fallbackState = {
            ...firstSnapshot.state,
            categories,
            errorMessage: '',
            isLoading: false,
            isRefreshing: false,
            pageCount: 1,
            redirectPage: firstSnapshot.state.page,
          }
          pageSnapshotsRef.current.clear()
          pageSnapshotsRef.current.set(firstSnapshot.state.page, {
            fingerprint: firstSnapshot.fingerprint,
            state: fallbackState,
          })
          return fallbackState
        }

        const nextState: CatalogPageState = {
          categories,
          errorMessage: '',
          isLoading: false,
          isRefreshing: false,
          items: result.items,
          page,
          pageCount: resolvePageCount(
            page,
            result.pageCount,
            pageCountCeilingRef.current,
            unsupportedPaginationRef.current,
          ),
          redirectPage: null,
          total: result.total,
        }
        pageSnapshotsRef.current.set(page, { fingerprint, state: nextState })
        return nextState
      }
      const cachedState = cached ? applyResult(cached.result) : undefined
      setState(
        cachedState
          ? {
              ...cachedState,
              isRefreshing: needsUpdate,
              redirectPage: needsUpdate ? null : cachedState.redirectPage,
            }
          : { ...emptyPageState, categories: readCachedVodCategories(source), isLoading: true },
      )
      if (!needsUpdate) return
      try {
        const entry = await fetchVodCatalogPage(source, { sourceId: source.id, page, categoryId, keyword })
        if (!isCurrent()) return
        if (cached || force) {
          pageCountCeilingRef.current = null
          pageSnapshotsRef.current.clear()
          unsupportedPaginationRef.current = false
        }
        setState(applyResult(entry.result))
      } catch (error) {
        if (!isCurrent()) return
        if (cachedState) {
          setState({ ...cachedState, errorMessage: toErrorMessage(error), isRefreshing: false, redirectPage: null })
          return
        }
        const fallbackSnapshot = getNearestSnapshot(pageSnapshotsRef.current, page)
        if (fallbackSnapshot) {
          const isSamePage = fallbackSnapshot.state.page === page
          setState({
            ...fallbackSnapshot.state,
            errorMessage: isSamePage ? toErrorMessage(error) : '',
            isLoading: false,
            isRefreshing: false,
            redirectPage: isSamePage ? null : fallbackSnapshot.state.page,
          })
        } else {
          setState((current) => ({
            ...current,
            errorMessage: toErrorMessage(error),
            isLoading: false,
            isRefreshing: false,
            redirectPage: null,
          }))
        }
      }
    },
    [categoryId, keyword, page, paginationContextKey],
  )

  /** 切换目录请求上下文并加载当前分页 */
  useEffect(() => {
    const source = sourceRef.current
    requestIdRef.current += 1
    if (!source) {
      activeSourceKeyRef.current = ''
      pageCountCeilingRef.current = null
      pageSnapshotsRef.current.clear()
      setState(emptyPageState)
      return
    }
    if (paginationContextKeyRef.current !== paginationContextKey || appliedCacheRevisionRef.current !== cacheRevision) {
      paginationContextKeyRef.current = paginationContextKey
      appliedCacheRevisionRef.current = cacheRevision
      pageCountCeilingRef.current = null
      pageSnapshotsRef.current.clear()
      unsupportedPaginationRef.current = false
      for (const result of readVodCatalogContext(paginationContextKey)) {
        if (!result.items.length) continue
        pageSnapshotsRef.current.set(result.page, {
          fingerprint: createPageFingerprint(result.items),
          state: { ...emptyPageState, ...result, redirectPage: null },
        })
      }
    }
    const categories =
      activeSourceKeyRef.current === sourceKey ? stateRef.current.categories : readCachedVodCategories(source)
    activeSourceKeyRef.current = sourceKey
    const firstPage = readVodCatalogPage(paginationContextKey, 1)
    if (
      page > 1 &&
      unsupportedPaginationRef.current &&
      firstPage &&
      !isRecommendationCacheExpired(firstPage.fetchedAt)
    ) {
      setState({ ...emptyPageState, categories, redirectPage: 1 })
      return
    }
    setState({ ...emptyPageState, categories, isLoading: true })
    void requestPage()
    return () => {
      requestIdRef.current += 1
    }
  }, [cacheRevision, page, paginationContextKey, requestPage, sourceKey])

  return useMemo(
    () => ({
      ...state,
      retry: () => requestPage(true),
    }),
    [requestPage, state],
  )
}

/** 将页面资源 ID 排序并拼接为内容指纹 */
function createPageFingerprint(items: VodSearchResult[]): string {
  return items
    .map((item) => `${item.sourceId}:${item.vodId}`)
    .sort()
    .join('|')
}

/** 合并接口页数、当前页和已知上限，得到可访问页数 */
function resolvePageCount(
  page: number,
  reportedPageCount: number,
  ceiling: number | null,
  unsupported: boolean,
): number {
  if (unsupported) return 1
  const pageCount = Math.max(page, reportedPageCount)
  return ceiling === null ? pageCount : Math.max(page, Math.min(pageCount, ceiling))
}

/** 查找与当前页内容指纹相同的其他分页快照 */
function findDuplicateSnapshot(
  snapshots: Map<number, PageSnapshot>,
  page: number,
  fingerprint: string,
): PageSnapshot | undefined {
  if (!fingerprint) return undefined
  for (const [snapshotPage, snapshot] of snapshots) {
    if (snapshotPage !== page && snapshot.fingerprint === fingerprint) return snapshot
  }
  return undefined
}

/** 获取当前页之前距离最近的分页快照 */
function getPreviousSnapshot(snapshots: Map<number, PageSnapshot>, page: number): PageSnapshot | undefined {
  let previousPage = 0
  let previousSnapshot: PageSnapshot | undefined
  for (const [snapshotPage, snapshot] of snapshots) {
    if (snapshotPage < page && snapshotPage > previousPage) {
      previousPage = snapshotPage
      previousSnapshot = snapshot
    }
  }
  return previousSnapshot
}

/** 获取与当前页码距离最近的分页快照 */
function getNearestSnapshot(snapshots: Map<number, PageSnapshot>, page: number): PageSnapshot | undefined {
  let distance = Number.POSITIVE_INFINITY
  let nearestSnapshot: PageSnapshot | undefined
  for (const [snapshotPage, snapshot] of snapshots) {
    const nextDistance = Math.abs(snapshotPage - page)
    if (nextDistance < distance) {
      distance = nextDistance
      nearestSnapshot = snapshot
    }
  }
  return nearestSnapshot
}

/** 将未知错误转换为可展示的错误消息 */
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
