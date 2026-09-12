import { getVodCatalogPage } from '@/platform/api'
import type { VodCatalogPage, VodCatalogRequest, VodSourceConfig } from '@/types'

/** 推荐列表从成功加载时起保留十分钟有效期 */
export const RECOMMENDATION_CACHE_TTL_MS = 10 * 60 * 1000
/** 点播目录最多保留最近使用的一百页 */
const MAX_CATALOG_PAGES = 100

interface CatalogCacheEntry {
  sourceKey: string
  contextKey: string
  result: VodCatalogPage
  fetchedAt: number
}

/** 当前窗口的成功结果与进行中请求，清理后旧请求不得回填 */
const pages = new Map<string, CatalogCacheEntry>()
const pending = new Map<string, { sourceKey: string; promise: Promise<CatalogCacheEntry> }>()
const listeners = new Set<() => void>()
let revision = 0

/** 将影响点播结果的源配置序列化为稳定缓存键 */
export function getVodCatalogSourceKey(source: VodSourceConfig): string {
  return JSON.stringify([
    source.id,
    source.name,
    source.url,
    Object.entries(source.headers)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)),
  ])
}

/** 标识同一个点播源下的分类和搜索上下文 */
export function getVodCatalogContextKey(source: VodSourceConfig, categoryId?: string, keyword?: string): string {
  return JSON.stringify([getVodCatalogSourceKey(source), categoryId?.trim() ?? '', keyword?.trim() ?? ''])
}

/** 读取当前页缓存并更新最近访问顺序，不延长有效期 */
export function readVodCatalogPage(contextKey: string, page: number): CatalogCacheEntry | undefined {
  const key = JSON.stringify([contextKey, page])
  const entry = pages.get(key)
  if (entry) {
    pages.delete(key)
    pages.set(key, entry)
  }
  return entry
}

/** 读取同一分页上下文内仍有效的结果，供分页校正恢复历史快照 */
export function readVodCatalogContext(contextKey: string): VodCatalogPage[] {
  return [...pages.values()]
    .filter((entry) => entry.contextKey === contextKey && !isRecommendationCacheExpired(entry.fetchedAt))
    .map((entry) => entry.result)
    .sort((a, b) => a.page - b.page)
}

/** 判断成功结果是否已经达到十分钟有效期 */
export function isRecommendationCacheExpired(fetchedAt: number): boolean {
  return Date.now() - fetchedAt >= RECOMMENDATION_CACHE_TTL_MS
}

/** 发起或复用同页请求，仅将有效请求的成功结果写入缓存 */
export function fetchVodCatalogPage(source: VodSourceConfig, input: VodCatalogRequest): Promise<CatalogCacheEntry> {
  const sourceKey = getVodCatalogSourceKey(source)
  const contextKey = getVodCatalogContextKey(source, input.categoryId, input.keyword)
  const key = JSON.stringify([contextKey, input.page])
  const existing = pending.get(key)
  if (existing) return existing.promise
  const task = {
    sourceKey,
    promise: Promise.resolve()
      .then(() => getVodCatalogPage(input))
      .then((result) => {
        if (pending.get(key) !== task) throw new Error('目录缓存已失效')
        const entry = { sourceKey, contextKey, result: { ...result, page: input.page }, fetchedAt: Date.now() }
        pages.delete(key)
        pages.set(key, entry)
        while (pages.size > MAX_CATALOG_PAGES) pages.delete(pages.keys().next().value!)
        return entry
      })
      .finally(() => {
        if (pending.get(key) === task) pending.delete(key)
      }),
  }
  pending.set(key, task)
  return task.promise
}

/** 移除已修改、删除或停用的源缓存及其进行中请求 */
export function pruneVodCatalogPages(sources: VodSourceConfig[]): void {
  const validKeys = new Set(sources.filter((source) => !source.disabled).map(getVodCatalogSourceKey))
  let changed = false
  for (const cache of [pages, pending]) {
    for (const [key, entry] of cache) {
      if (!validKeys.has(entry.sourceKey)) {
        cache.delete(key)
        changed = true
      }
    }
  }
  if (changed) notifyInvalidation()
}

/** 清空分页结果并使旧请求失效，通知当前页面重新读取 */
export function clearVodCatalogPages(): void {
  pages.clear()
  pending.clear()
  notifyInvalidation()
}

/** 返回同步失效版本，阻止清理后的旧响应更新页面 */
export function getVodCatalogCacheRevision(): number {
  return revision
}

/** 订阅当前窗口的目录缓存失效通知 */
export function subscribeVodCatalogInvalidation(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 发布一次缓存失效并推进版本 */
function notifyInvalidation(): void {
  revision += 1
  for (const listener of listeners) listener()
}
