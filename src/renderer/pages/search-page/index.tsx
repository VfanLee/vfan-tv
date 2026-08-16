import { useEffect, useRef, useState } from 'react'
import { Settings2, Video } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router'
import type { VodSearchResult } from '@shared/types'
import { EmptyState } from '@renderer/components'
import { useSearchContextStore } from '@/stores'
import { SearchBox } from '@/ui'
import { openSettingsWindow } from '@renderer/platform/api'
import { SearchHistory } from './components/search-history'
import {
  GroupedResults,
  SearchEmptyState,
  SearchStats,
  SourceResults,
  ViewModeSwitch,
} from './components/search-results'
import { useVodSearch } from './hooks/use-vod-search'
import type { GroupedSearchResult } from './types'
import { normalizeTitle } from './utils'

/** 渲染搜索页面 */
export function SearchPage(): React.JSX.Element {
  const [searchParams] = useSearchParams()
  const urlKeyword = searchParams.get('keyword')?.trim() ?? ''
  return <SearchPageContent key={urlKeyword || '__empty__'} urlKeyword={urlKeyword} />
}

/** 渲染搜索页面内容 */
function SearchPageContent({ urlKeyword }: { urlKeyword: string }): React.JSX.Element {
  const navigate = useNavigate()
  const setContext = useSearchContextStore((state) => state.setContext)
  const [keyword, setKeyword] = useState(urlKeyword)
  const inputRef = useRef<HTMLInputElement>(null)
  const search = useVodSearch(urlKeyword)

  /** 聚焦搜索框并监听全局聚焦事件 */
  useEffect(() => {
    /** 聚焦搜索 */
    const focusSearch = (): void => inputRef.current?.focus()
    const frame = window.requestAnimationFrame(focusSearch)
    window.addEventListener('vfan-tv:focus-search', focusSearch)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('vfan-tv:focus-search', focusSearch)
    }
  }, [])

  /** 提交搜索 */
  const submitSearch = (): void => {
    const nextKeyword = keyword.trim()
    if (!nextKeyword) {
      inputRef.current?.focus()
      return
    }
    navigate(`/search?keyword=${encodeURIComponent(nextKeyword)}`)
  }

  /** 清除搜索 */
  const clearSearch = (): void => {
    setKeyword('')
    void search.cancelSearch()
    navigate('/search')
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }

  /** 更新搜索词，输入被清空时同步结束当前搜索 */
  const changeKeyword = (nextKeyword: string): void => {
    if (!nextKeyword.trim()) {
      clearSearch()
      return
    }
    setKeyword(nextKeyword)
  }

  /** 打开聚合结果播放器 */
  const openGroupedPlayer = (group: GroupedSearchResult): void => {
    const firstItem = group.items[0]
    if (!firstItem) return
    setContext(search.keyword.trim(), group.items)
    navigate(`/vod/${firstItem.sourceId}/${firstItem.vodId}`)
  }

  /** 打开源播放器 */
  const openSourcePlayer = (item: VodSearchResult): void => {
    setContext(
      search.keyword.trim(),
      search.allItems.filter((candidate) => normalizeTitle(candidate.title) === normalizeTitle(item.title)),
    )
    navigate(`/vod/${item.sourceId}/${item.vodId}`)
  }

  return (
    <div className="text-foreground min-h-full bg-transparent px-5 pb-10 sm:px-8 lg:px-10">
      <div className="mx-auto w-full max-w-[1800px]">
        <section className="bg-background/92 sticky top-0 z-30 py-5 backdrop-blur-xl sm:py-6">
          <SearchBox
            ariaLabel="搜索影片"
            autoFocus
            inputRef={inputRef}
            placeholder="输入影片名称"
            submitLabel="搜索"
            value={keyword}
            onChange={changeKeyword}
            onClear={clearSearch}
            onSubmit={submitSearch}
          />
        </section>

        <SearchHistory
          histories={search.histories}
          onClear={search.clearHistories}
          onPick={(history) => navigate(`/search?keyword=${encodeURIComponent(history)}`)}
          onRemove={search.removeHistory}
        />

        {search.isSourcesReady && !search.hasAvailableSources ? (
          <EmptyState
            action={{ icon: Settings2, label: '打开设置', onClick: () => void openSettingsWindow('vod-sources') }}
            density="page"
            description="请先在设置中添加点播源，或启用一个已有的点播源后再搜索。"
            icon={Video}
            title="还没有可用的点播源"
          />
        ) : (
          <section className="border-border mt-8 border-t pt-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <h1 className="text-2xl font-semibold tracking-tight">搜索结果</h1>
                <SearchStats stats={search.stats} />
              </div>
              <div className="flex items-center gap-3">
                {search.isSearching || search.searchId ? (
                  <button
                    className="border-primary bg-card text-primary hover:bg-accent focus-visible:ring-ring h-10 rounded-xl border px-4 text-sm font-semibold outline-none focus-visible:ring-2"
                    type="button"
                    onClick={() => void search.cancelSearch()}
                  >
                    停止搜索
                  </button>
                ) : null}
                <ViewModeSwitch value={search.viewMode} onChange={search.changeViewMode} />
              </div>
            </div>

            {search.hasSearched ? (
              search.viewMode === 'grouped' ? (
                <GroupedResults
                  groups={search.groupedResults}
                  isSearching={search.isSearching}
                  onOpen={openGroupedPlayer}
                />
              ) : (
                <SourceResults sources={search.sourceList} onOpen={openSourcePlayer} />
              )
            ) : (
              <SearchEmptyState />
            )}
          </section>
        )}
      </div>
    </div>
  )
}
