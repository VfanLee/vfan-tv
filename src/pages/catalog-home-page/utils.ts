import type { VodCatalogCategory } from '@/types'

/** 代表“全部分类”的筛选值 */
export const ALL_CATEGORIES_VALUE = '__all__'

/** 将查询参数转换为大于等于 1 的页码 */
export function normalizePage(value: string | null): number {
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 ? page : 1
}

/** 构建分类层级 */
export function buildCategoryHierarchy(
  categories: VodCatalogCategory[],
  selectedId?: string,
): {
  children: VodCatalogCategory[]
  roots: VodCatalogCategory[]
  selectedParent?: VodCatalogCategory
} {
  const ids = new Set(categories.map((category) => category.id))
  const roots = categories.filter((category) => category.parentId === '0' || !ids.has(category.parentId))
  const normalizedRoots = roots.length > 0 ? roots : categories
  const selected = categories.find((category) => category.id === selectedId)
  const selectedParent = selected
    ? normalizedRoots.some((category) => category.id === selected.id)
      ? selected
      : categories.find((category) => category.id === selected.parentId)
    : undefined
  const children = selectedParent ? categories.filter((category) => category.parentId === selectedParent.id) : []
  return { children, roots: normalizedRoots, selectedParent }
}

/** 解析分类选择状态 */
export function resolveCategorySelection(categoryId: string | null, categories: VodCatalogCategory[]): string | null {
  if (!categoryId) return null
  return categories.find((category) => category.parentId === categoryId)?.id ?? categoryId
}
