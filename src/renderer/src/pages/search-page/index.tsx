import { useNavigate, useSearchParams } from 'react-router'
import type { VodSearchResult } from '@shared/types'
import { useSearchContextStore } from '@renderer/stores/search-context'
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

export function SearchPage(): React.JSX.Element {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const setContext = useSearchContextStore((state) => state.setContext)
  const search = useVodSearch(searchParams.get('keyword')?.trim() ?? '')

  const openGroupedPlayer = (group: GroupedSearchResult): void => {
    const firstItem = group.items[0]
    if (!firstItem) return
    setContext(search.keyword.trim(), group.items)
    navigate(`/vod/${firstItem.sourceId}/${firstItem.vodId}`)
  }

  const openSourcePlayer = (item: VodSearchResult): void => {
    setContext(
      search.keyword.trim(),
      search.allItems.filter((candidate) => normalizeTitle(candidate.title) === normalizeTitle(item.title)),
    )
    navigate(`/vod/${item.sourceId}/${item.vodId}`)
  }

  return (
    <div className="bg-background text-foreground min-h-full px-10 pb-10">
      <div className="mx-auto max-w-[1280px] pt-8">
        <SearchHistory
          histories={search.histories}
          onClear={search.clearHistories}
          onPick={(history) => navigate(`/search?keyword=${encodeURIComponent(history)}`)}
          onRemove={search.removeHistory}
        />

        <section className="border-border mt-8 border-t pt-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <h1 className="text-lg font-semibold tracking-tight">搜索结果</h1>
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
      </div>
    </div>
  )
}
