import type { VodCatalogCategory, VodSourceConfig } from '@/types'

interface CategoryCacheEntry {
  categories: VodCatalogCategory[]
  sourceUrl: string
}

/** 当前窗口内的目录分类缓存，随窗口关闭释放 */
const categoryCache = new Map<string, CategoryCacheEntry>()

/** 读取源地址仍匹配的分类缓存 */
export function readCachedVodCategories(source: Pick<VodSourceConfig, 'id' | 'url'>): VodCatalogCategory[] {
  const entry = categoryCache.get(source.id)
  return entry?.sourceUrl === source.url ? structuredClone(entry.categories) : []
}

/** 缓存规范化后的分类列表 */
export function writeCachedVodCategories(
  source: Pick<VodSourceConfig, 'id' | 'url'>,
  categories: VodCatalogCategory[],
): void {
  const normalizedCategories = normalizeCategories(categories)
  if (normalizedCategories.length === 0) return
  categoryCache.set(source.id, { categories: normalizedCategories, sourceUrl: source.url })
}

/** 移除已删除或已更换地址的源缓存 */
export function pruneVodCategoryCache(sources: Array<Pick<VodSourceConfig, 'id' | 'url'>>): void {
  const availableSources = new Map(sources.map((source) => [source.id, source.url]))
  for (const [sourceId, entry] of categoryCache) {
    if (availableSources.get(sourceId) !== entry.sourceUrl) categoryCache.delete(sourceId)
  }
}

/** 清空当前窗口的分类缓存 */
export function clearVodCategoryCache(): void {
  categoryCache.clear()
}

/** 过滤无效分类并按分类标识去重 */
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

/** 判断分类数据是否为对象 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
