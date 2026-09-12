import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { AlertCircle, Search, ServerCog } from 'lucide-react'
import { toast } from 'sonner'
import { useUiPreferencesStore } from '@/stores'
import type { VodSearchResult, VodSourceConfig } from '@/types'
import { PosterCardSkeleton, VodSourceBackupSwitcher } from '@/components'
import { getVodDetail, openSettingsWindow } from '@/platform/api'
import {
  Alert,
  AlertAction,
  AlertDescription,
  Button,
  SegmentedTabs,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui'
import { useSearchContextStore } from '@/stores'
import { useEnabledVodSources, useVodCatalog } from './hooks/use-vod-catalog'
import { CatalogPagination } from './components/catalog-pagination'
import { CatalogSearchForm } from './components/catalog-search-form'
import { CatalogCard } from './components/catalog-card'
import { CatalogMessage, NoSourceState } from './components/catalog-empty-state'
import { ALL_CATEGORIES_VALUE, normalizePage, buildCategoryHierarchy, resolveCategorySelection } from './utils'

/** 渲染资源库首页 */
export function CatalogHomePage(): React.JSX.Element {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const setContext = useSearchContextStore((state) => state.setContext)
  const sourcesState = useEnabledVodSources()
  const requestedSourceId = searchParams.get('source')
  const storedSourceId = useUiPreferencesStore((state) => state.catalogSourceId)
  /** 按路由参数、本地缓存和源顺序解析出的当前点播源 */
  const selectedSource =
    sourcesState.sources.find((source) => source.id === requestedSourceId) ??
    sourcesState.sources.find((source) => source.id === storedSourceId) ??
    sourcesState.sources[0]
  const categoryId = searchParams.get('category')?.trim() || undefined
  const keyword = searchParams.get('keyword')?.trim() || undefined
  const requestedPage = normalizePage(searchParams.get('page'))
  const catalog = useVodCatalog({ source: selectedSource, categoryId, keyword, page: requestedPage })
  const [pendingDetailKey, setPendingDetailKey] = useState<string>()
  /** 根据当前分类构建的资源目录分类层级 */
  const hierarchy = buildCategoryHierarchy(catalog.categories, categoryId)

  /** 将当前点播源同步到查询参数 */
  useEffect(() => {
    if (!selectedSource || searchParams.get('source') === selectedSource.id) return
    const next = new URLSearchParams(searchParams)
    next.set('source', selectedSource.id)
    setSearchParams(next, { replace: true })
  }, [searchParams, selectedSource, setSearchParams])

  /** 将当前点播源保存到本地存储 */
  useEffect(() => {
    if (selectedSource) {
      if (useUiPreferencesStore.getState().catalogSourceId !== selectedSource.id)
        useUiPreferencesStore.getState().setCatalogSourceId(selectedSource.id)
    }
  }, [selectedSource])

  /** 将无效分页重定向到可访问页码 */
  useEffect(() => {
    if (!selectedSource || catalog.redirectPage === null || catalog.redirectPage === requestedPage) return
    const next = new URLSearchParams(searchParams)
    next.set('source', selectedSource.id)
    if (catalog.redirectPage === 1) next.delete('page')
    else next.set('page', String(catalog.redirectPage))
    setSearchParams(next, { replace: true })
  }, [catalog.redirectPage, requestedPage, searchParams, selectedSource, setSearchParams])

  /** 更新资源分类或关键词，并重置分页参数 */
  const updateFilters = (updates: { category?: string | null; keyword?: string | null }): void => {
    if (!selectedSource) return
    const next = new URLSearchParams()
    next.set('source', selectedSource.id)
    const nextCategory = updates.category === undefined ? categoryId : updates.category
    const nextKeyword = updates.keyword === undefined ? keyword : updates.keyword
    if (nextCategory) next.set('category', nextCategory)
    if (nextKeyword?.trim()) next.set('keyword', nextKeyword.trim())
    setSearchParams(next)
  }

  /** 切换资源目录页码并更新查询参数 */
  const updatePage = (page: number): void => {
    if (!selectedSource || page < 1 || page === requestedPage) return
    const next = new URLSearchParams(searchParams)
    next.set('source', selectedSource.id)
    if (page === 1) next.delete('page')
    else next.set('page', String(page))
    setSearchParams(next)
  }

  /** 切换备用源 */
  const switchBackup = async (source: VodSourceConfig, backupUrl: string): Promise<void> => {
    try {
      const updated = await sourcesState.switchBackup(source.id, backupUrl)
      const next = new URLSearchParams(searchParams)
      next.set('source', updated.id)
      setSearchParams(next, { replace: true })
      toast.success('已切换备用地址', { description: updated.url })
    } catch (error) {
      toast.error('备用地址切换失败', { description: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  /** 加载点播详情并跳转到点播播放页 */
  const openDetail = async (item: VodSearchResult): Promise<void> => {
    const key = `${item.sourceId}:${item.vodId}`
    if (pendingDetailKey) return
    setPendingDetailKey(key)
    try {
      const detail = await getVodDetail(item.sourceId, item.vodId)
      setContext(keyword ?? detail.title, [detail])
      navigate(`/vod/${detail.sourceId}/${detail.vodId}`)
    } catch (error) {
      toast.error('详情加载失败', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setPendingDetailKey(undefined)
    }
  }

  if (!sourcesState.isLoading && sourcesState.sources.length === 0) {
    return (
      <NoSourceState
        errorMessage={sourcesState.errorMessage}
        onOpenSettings={() => void openSettingsWindow('vod-sources')}
      />
    )
  }

  return (
    <div className="text-foreground min-h-full bg-transparent">
      <div className="relative mx-auto w-full max-w-[1800px] px-5 py-6 sm:px-8 lg:px-10 lg:py-9">
        <section className="border-border bg-card/90 overflow-hidden rounded-[28px] border shadow-sm backdrop-blur">
          <div className="grid gap-8 px-6 py-7 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)] lg:px-9 lg:py-9">
            <div className="flex min-w-0 items-center">
              <h1 className="truncate text-3xl font-bold tracking-[-0.035em] sm:text-4xl lg:text-5xl">
                {selectedSource?.name ?? '正在接入片库'}
              </h1>
            </div>

            <div className="flex min-w-0 flex-col justify-end gap-3">
              <label className="text-muted-foreground font-mono text-[11px] font-semibold tracking-[0.18em] uppercase">
                当前点播源
              </label>
              <div className="flex min-w-0 items-center gap-2">
                <Select
                  value={selectedSource?.id ?? ''}
                  onValueChange={(sourceId) => {
                    const next = new URLSearchParams(searchParams)
                    next.set('source', sourceId)
                    next.delete('category')
                    next.delete('page')
                    setSearchParams(next)
                  }}
                >
                  <SelectTrigger className="border-input bg-background hover:bg-accent h-12 min-w-0 flex-1 px-4">
                    <SelectValue placeholder="选择点播源" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {sourcesState.sources.map((source) => (
                        <SelectItem key={source.id} value={source.id}>
                          {source.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {selectedSource && selectedSource.backups.length > 0 ? (
                  <VodSourceBackupSwitcher align="end" source={selectedSource} onSwitchBackup={switchBackup}>
                    <Button aria-label="切换备用地址" size="icon-lg" type="button" variant="outline">
                      <ServerCog data-icon="inline-start" />
                    </Button>
                  </VodSourceBackupSwitcher>
                ) : null}
              </div>
            </div>
          </div>

          <div className="border-border bg-muted/35 border-t px-6 py-5 lg:px-9">
            <CatalogSearchForm
              key={keyword ?? ''}
              initialValue={keyword ?? ''}
              onClear={() => updateFilters({ keyword: null })}
              onSubmit={(value) => updateFilters({ keyword: value })}
            />
          </div>
        </section>

        <section className="mt-6">
          <h2 className="mb-4 text-2xl font-bold tracking-tight">分类</h2>
          <SegmentedTabs
            ariaLabel="影片分类"
            className="max-w-full flex-wrap"
            items={[
              { value: ALL_CATEGORIES_VALUE, label: '全部' },
              ...hierarchy.roots.map((category) => ({ value: category.id, label: category.name })),
            ]}
            value={hierarchy.selectedParent?.id ?? ALL_CATEGORIES_VALUE}
            onValueChange={(id) =>
              updateFilters({
                category: id === ALL_CATEGORIES_VALUE ? null : resolveCategorySelection(id, catalog.categories),
              })
            }
          />
          {hierarchy.children.length > 0 && hierarchy.selectedParent ? (
            <div className="mt-3">
              <SegmentedTabs
                ariaLabel={`${hierarchy.selectedParent.name}子分类`}
                className="max-w-full flex-wrap"
                items={hierarchy.children.map((category) => ({ value: category.id, label: category.name }))}
                value={
                  hierarchy.children.some((category) => category.id === categoryId)
                    ? (categoryId ?? hierarchy.children[0].id)
                    : hierarchy.children[0].id
                }
                onValueChange={(id) => updateFilters({ category: id })}
              />
            </div>
          ) : null}
        </section>

        <section className="mt-8">
          <h2 className="mb-5 text-2xl font-bold tracking-tight">{keyword ? `“${keyword}”的结果` : '片库内容'}</h2>
          {catalog.isRefreshing ? (
            <p role="status" className="text-muted-foreground mb-4 text-sm">
              正在更新片库，当前内容仍可浏览
            </p>
          ) : null}

          {catalog.isLoading ? (
            <div className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 12 }, (_, index) => (
                <PosterCardSkeleton key={index} />
              ))}
            </div>
          ) : catalog.errorMessage && catalog.items.length === 0 ? (
            <CatalogMessage
              icon={AlertCircle}
              title="片库暂时没有回应"
              description={catalog.errorMessage}
              action="重新加载"
              onAction={() => void catalog.retry()}
            />
          ) : catalog.items.length === 0 ? (
            <CatalogMessage
              icon={Search}
              title="没有找到匹配内容"
              description="尝试切换分类、清除关键词，或选择另一个点播源。"
            />
          ) : (
            <>
              <div className="grid grid-cols-2 items-start gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {catalog.items.map((item) => (
                  <CatalogCard
                    key={`${item.sourceId}:${item.vodId}`}
                    item={item}
                    pending={pendingDetailKey === `${item.sourceId}:${item.vodId}`}
                    onOpen={() => void openDetail(item)}
                  />
                ))}
              </div>

              {catalog.errorMessage ? (
                <Alert className="mt-10 pr-40" variant="destructive">
                  <AlertCircle />
                  <AlertDescription>{catalog.errorMessage}</AlertDescription>
                  <AlertAction>
                    <Button size="sm" variant="outline" onClick={() => void catalog.retry()}>
                      重新加载当前页
                    </Button>
                  </AlertAction>
                </Alert>
              ) : catalog.pageCount > 1 ? (
                <CatalogPagination
                  currentPage={catalog.page || requestedPage}
                  disabled={catalog.isLoading}
                  getPageHref={(page) => {
                    const next = new URLSearchParams(searchParams)
                    if (page === 1) next.delete('page')
                    else next.set('page', String(page))
                    return `?${next.toString()}`
                  }}
                  pageCount={catalog.pageCount}
                  onPageChange={updatePage}
                />
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
