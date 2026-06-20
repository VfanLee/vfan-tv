import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Heart, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { FavoriteItem } from '@shared/types'
import { MediaPoster, PosterPlayOverlay } from '@renderer/components'
import { listFavorites, removeFavorite } from '@renderer/services/api'
import { favoriteToVodSearchResult } from '@renderer/services/playback'
import { useSearchContextStore } from '@renderer/stores/search-context'

export function FavoritesPage(): React.JSX.Element {
  const navigate = useNavigate()
  const setContext = useSearchContextStore((state) => state.setContext)
  const [items, setItems] = useState<FavoriteItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true
    void listFavorites()
      .then((nextItems) => {
        if (active) {
          setItems(nextItems)
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [])

  const handleDelete = async (item: FavoriteItem): Promise<void> => {
    if (!window.confirm(`确定删除收藏「${item.title}」吗？`)) {
      return
    }

    try {
      await removeFavorite(item.sourceId, item.vodId)
      setItems((currentItems) => currentItems.filter((currentItem) => currentItem.id !== item.id))
      toast.success('已删除收藏')
    } catch (error) {
      toast.error('删除失败', {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <div className="bg-background text-foreground min-h-full px-10 py-9 pr-24">
      <div className="mx-auto max-w-[1500px]">
        <header className="mb-8">
          <div className="flex items-center gap-2">
            <Heart className="text-primary" size={22} />
            <h1 className="text-2xl font-semibold tracking-tight">我的收藏</h1>
          </div>
        </header>

        {items.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] items-start gap-x-6 gap-y-9">
            {items.map((item) => (
              <FavoriteCard
                key={item.id}
                item={item}
                onClick={() => {
                  setContext(item.title, [favoriteToVodSearchResult(item)])
                  navigate(`/player/${item.sourceId}/${item.vodId}`)
                }}
                onDelete={() => void handleDelete(item)}
              />
            ))}
          </div>
        ) : (
          <div className="border-input bg-card flex h-72 items-center justify-center rounded-xl border border-dashed">
            <div className="text-center">
              <Search className="text-muted-foreground mx-auto" size={28} />
              <div className="mt-3 text-sm font-semibold">{isLoading ? '正在加载收藏' : '还没有收藏内容'}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function FavoriteCard({
  item,
  onClick,
  onDelete,
}: {
  item: FavoriteItem
  onClick: () => void
  onDelete: () => void
}): React.JSX.Element {
  return (
    <div className="group relative min-w-0">
      <button
        className="focus-visible:ring-ring focus-visible:ring-offset-background w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        type="button"
        onClick={onClick}
      >
        <MediaPoster
          baseUrl={item.sourceBaseUrl}
          className="aspect-[2/3]"
          headers={item.sourceHeaders}
          poster={item.poster}
          title={item.title}
          overlay={<PosterPlayOverlay />}
        />
        <h2 className="text-foreground mt-3 truncate text-[15px] font-semibold">{item.title}</h2>
        <p className="text-muted-foreground mt-1 truncate text-sm">
          {[item.sourceName, item.year, item.category || item.remarks].filter(Boolean).join(' · ')}
        </p>
      </button>
      <button
        className="bg-background/85 text-muted-foreground hover:bg-destructive focus-visible:ring-ring absolute top-2 right-2 flex size-8 items-center justify-center rounded-full opacity-0 shadow-sm backdrop-blur transition group-hover:opacity-100 hover:text-white focus:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
        type="button"
        title="删除收藏"
        onClick={onDelete}
      >
        <Trash2 size={15} />
      </button>
    </div>
  )
}
