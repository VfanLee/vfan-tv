import { VOD_CATALOG_CATEGORY_CACHE_STORAGE_KEY } from '@shared/constants'
import type { VodCatalogCategory, VodSourceConfig } from '@shared/types'

interface StoredCategoryCacheEntry {
  categories: VodCatalogCategory[]
  sourceUrl: string
  updatedAt: number
}

interface StoredCategoryCache {
  sources: Record<string, StoredCategoryCacheEntry>
  version: 1
}

const emptyCache = (): StoredCategoryCache => ({ sources: {}, version: 1 })

export function readCachedVodCategories(source: Pick<VodSourceConfig, 'id' | 'url'>): VodCatalogCategory[] {
  const entry = readCache().sources[source.id]
  return entry?.sourceUrl === source.url ? entry.categories : []
}

export function writeCachedVodCategories(
  source: Pick<VodSourceConfig, 'id' | 'url'>,
  categories: VodCatalogCategory[],
): void {
  const normalizedCategories = normalizeCategories(categories)
  if (normalizedCategories.length === 0) return

  const cache = readCache()
  cache.sources[source.id] = {
    categories: normalizedCategories,
    sourceUrl: source.url,
    updatedAt: Date.now(),
  }
  writeCache(cache)
}

export function pruneVodCategoryCache(sources: Array<Pick<VodSourceConfig, 'id' | 'url'>>): void {
  const cache = readCache()
  const availableSources = new Map(sources.map((source) => [source.id, source.url]))
  const nextSources = Object.fromEntries(
    Object.entries(cache.sources).filter(([sourceId, entry]) => availableSources.get(sourceId) === entry.sourceUrl),
  )

  if (Object.keys(nextSources).length !== Object.keys(cache.sources).length) {
    writeCache({ sources: nextSources, version: 1 })
  }
}

export function clearVodCategoryCache(): void {
  try {
    window.localStorage.removeItem(VOD_CATALOG_CATEGORY_CACHE_STORAGE_KEY)
  } catch {
    // localStorage 不可用时无需阻断其他缓存清理。
  }
}

function readCache(): StoredCategoryCache {
  try {
    const raw = window.localStorage.getItem(VOD_CATALOG_CATEGORY_CACHE_STORAGE_KEY)
    if (!raw) return emptyCache()
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.sources)) return emptyCache()

    const sources: Record<string, StoredCategoryCacheEntry> = {}
    for (const [sourceId, value] of Object.entries(parsed.sources)) {
      if (!isRecord(value) || typeof value.sourceUrl !== 'string' || typeof value.updatedAt !== 'number') continue
      const categories = normalizeCategories(value.categories)
      if (categories.length === 0) continue
      sources[sourceId] = { categories, sourceUrl: value.sourceUrl, updatedAt: value.updatedAt }
    }
    return { sources, version: 1 }
  } catch {
    return emptyCache()
  }
}

function writeCache(cache: StoredCategoryCache): void {
  try {
    window.localStorage.setItem(VOD_CATALOG_CATEGORY_CACHE_STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // 缓存写入失败时仍使用当前会话内的分类数据。
  }
}

function normalizeCategories(value: unknown): VodCatalogCategory[] {
  if (!Array.isArray(value)) return []
  const categories = new Map<string, VodCatalogCategory>()

  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      !item.id.trim() ||
      typeof item.name !== 'string' ||
      !item.name.trim() ||
      typeof item.parentId !== 'string'
    ) {
      continue
    }
    const id = item.id.trim()
    categories.set(id, { id, name: item.name.trim(), parentId: item.parentId.trim() || '0' })
  }

  return [...categories.values()]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
