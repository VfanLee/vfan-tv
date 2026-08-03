import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { VodCatalogCategory, VodSearchResult, VodSourceConfig } from '@shared/types'
import { getVodCatalogPage, listSources, switchSourceBackup } from '@renderer/services/api'
import {
  pruneVodCategoryCache,
  readCachedVodCategories,
  writeCachedVodCategories,
} from '@renderer/services/cache/vod-catalog-categories'

interface CatalogPageState {
  categories: VodCatalogCategory[]
  errorMessage: string
  isLoading: boolean
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

const emptyPageState: CatalogPageState = {
  categories: [],
  errorMessage: '',
  isLoading: false,
  items: [],
  page: 0,
  pageCount: 0,
  redirectPage: null,
  total: 0,
}

export function useEnabledVodSources(): {
  errorMessage: string
  isLoading: boolean
  sources: VodSourceConfig[]
  switchBackup: (sourceId: string, backupUrl: string) => Promise<VodSourceConfig>
} {
  const [sources, setSources] = useState<VodSourceConfig[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let active = true
    void listSources()
      .then((items) => {
        if (!active) return
        pruneVodCategoryCache(items)
        setSources(items.filter((item) => item.enabled))
      })
      .catch((error: unknown) => {
        if (active) setErrorMessage(toErrorMessage(error))
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const switchBackup = useCallback(async (sourceId: string, backupUrl: string): Promise<VodSourceConfig> => {
    const updated = await switchSourceBackup(sourceId, backupUrl)
    setSources((current) => current.map((source) => (source.id === updated.id ? updated : source)))
    return updated
  }, [])

  return { errorMessage, isLoading, sources, switchBackup }
}

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
  const sourceKey = `${source?.id ?? ''}|${source?.url ?? ''}`
  const paginationContextKey = `${sourceKey}|${categoryId ?? ''}|${keyword ?? ''}`
  const requestKey = `${paginationContextKey}|${page}`
  const activeRequestKeyRef = useRef(requestKey)
  const activeSourceKeyRef = useRef(sourceKey)
  const paginationContextKeyRef = useRef(paginationContextKey)
  const pageCountCeilingRef = useRef<number | null>(null)
  const pageSnapshotsRef = useRef(new Map<number, PageSnapshot>())
  const unsupportedPaginationSourcesRef = useRef(new Set<string>())
  const stateRef = useRef(state)
  stateRef.current = state

  const requestPage = useCallback(async (): Promise<void> => {
    if (!source) return
    const requestIdentity = requestKey
    setState((current) => ({
      ...current,
      errorMessage: '',
      isLoading: true,
      redirectPage: null,
    }))
    try {
      const result = await getVodCatalogPage({ sourceId: source.id, page, categoryId, keyword })
      if (activeRequestKeyRef.current !== requestIdentity) return
      if (result.categories.length > 0) writeCachedVodCategories(source, result.categories)
      const categories = result.categories.length > 0 ? result.categories : stateRef.current.categories
      const fallbackSnapshot = getPreviousSnapshot(pageSnapshotsRef.current, page)

      if (page > 1 && result.items.length === 0) {
        pageCountCeilingRef.current = fallbackSnapshot?.state.page ?? 1
        if (fallbackSnapshot) {
          setState({
            ...fallbackSnapshot.state,
            categories,
            errorMessage: '',
            isLoading: false,
            pageCount: fallbackSnapshot.state.page,
            redirectPage: fallbackSnapshot.state.page,
          })
        } else {
          setState({ ...emptyPageState, categories, redirectPage: 1 })
        }
        return
      }

      const fingerprint = createPageFingerprint(result.items)
      const duplicateSnapshot = findDuplicateSnapshot(pageSnapshotsRef.current, page, fingerprint)
      if (page > 1 && duplicateSnapshot) {
        const onlyFirstPageKnown = pageSnapshotsRef.current.size === 1 && pageSnapshotsRef.current.has(1)
        if (!onlyFirstPageKnown) {
          pageCountCeilingRef.current = page - 1
          const previousSnapshot = getPreviousSnapshot(pageSnapshotsRef.current, page) ?? duplicateSnapshot
          setState({
            ...previousSnapshot.state,
            categories,
            errorMessage: '',
            isLoading: false,
            pageCount: Math.min(previousSnapshot.state.pageCount, page - 1),
            redirectPage: previousSnapshot.state.page,
          })
          return
        }

        unsupportedPaginationSourcesRef.current.add(sourceKey)
        const firstSnapshot = pageSnapshotsRef.current.get(1) ?? duplicateSnapshot
        const fallbackState = {
          ...firstSnapshot.state,
          categories,
          errorMessage: '',
          isLoading: false,
          pageCount: 1,
          redirectPage: firstSnapshot.state.page,
        }
        pageSnapshotsRef.current.clear()
        pageSnapshotsRef.current.set(firstSnapshot.state.page, {
          fingerprint: firstSnapshot.fingerprint,
          state: fallbackState,
        })
        setState(fallbackState)
        return
      }

      const nextState: CatalogPageState = {
        categories,
        errorMessage: '',
        isLoading: false,
        items: result.items,
        page,
        pageCount: resolvePageCount(
          page,
          result.pageCount,
          pageCountCeilingRef.current,
          unsupportedPaginationSourcesRef.current.has(sourceKey),
        ),
        redirectPage: null,
        total: result.total,
      }
      pageSnapshotsRef.current.set(page, { fingerprint, state: nextState })
      setState(nextState)
    } catch (error) {
      if (activeRequestKeyRef.current !== requestIdentity) return
      const fallbackSnapshot = getNearestSnapshot(pageSnapshotsRef.current, page)
      if (fallbackSnapshot) {
        const isSamePage = fallbackSnapshot.state.page === page
        setState({
          ...fallbackSnapshot.state,
          errorMessage: isSamePage ? toErrorMessage(error) : '',
          isLoading: false,
          redirectPage: isSamePage ? null : fallbackSnapshot.state.page,
        })
      } else {
        setState((current) => ({
          ...current,
          errorMessage: toErrorMessage(error),
          isLoading: false,
          redirectPage: null,
        }))
      }
    }
  }, [categoryId, keyword, page, requestKey, source, sourceKey])

  useEffect(() => {
    activeRequestKeyRef.current = requestKey
    if (!source) {
      activeSourceKeyRef.current = ''
      pageCountCeilingRef.current = null
      pageSnapshotsRef.current.clear()
      setState(emptyPageState)
      return
    }
    if (paginationContextKeyRef.current !== paginationContextKey) {
      paginationContextKeyRef.current = paginationContextKey
      pageCountCeilingRef.current = null
      pageSnapshotsRef.current.clear()
    }
    const categories =
      activeSourceKeyRef.current === sourceKey ? stateRef.current.categories : readCachedVodCategories(source)
    activeSourceKeyRef.current = sourceKey
    if (page > 1 && unsupportedPaginationSourcesRef.current.has(sourceKey)) {
      setState({ ...emptyPageState, categories, redirectPage: 1 })
      return
    }
    setState({ ...emptyPageState, categories, isLoading: true })
    void requestPage()
  }, [page, paginationContextKey, requestKey, requestPage, source, sourceKey])

  return useMemo(
    () => ({
      ...state,
      retry: requestPage,
    }),
    [requestPage, state],
  )
}

function createPageFingerprint(items: VodSearchResult[]): string {
  return items
    .map((item) => `${item.sourceId}:${item.vodId}`)
    .sort()
    .join('|')
}

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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
