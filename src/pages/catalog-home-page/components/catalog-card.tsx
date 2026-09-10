import { ChevronRight, Loader2 } from 'lucide-react'
import type { VodSearchResult } from '@/types'
import { MediaPoster } from '@/components'

/** 渲染资源目录卡片 */
export function CatalogCard({
  item,
  onOpen,
  pending,
}: {
  item: VodSearchResult
  onOpen: () => void
  pending: boolean
}): React.JSX.Element {
  const meta = [item.year, item.area, item.category].filter(Boolean).join(' · ')
  return (
    <button
      className="focus-visible:ring-ring focus-visible:ring-offset-background group min-w-0 rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-offset-4 disabled:cursor-wait"
      disabled={pending}
      type="button"
      onClick={onOpen}
    >
      <div className="relative">
        <MediaPoster
          baseUrl={item.sourceUrl}
          className="border-border bg-muted aspect-[2/3] shadow-sm"
          poster={item.poster}
          sourceId={item.sourceId}
          title={item.title}
        />
        {pending ? (
          <div className="bg-background/75 absolute inset-0 flex items-center justify-center rounded-xl backdrop-blur-sm">
            <Loader2 className="text-primary animate-spin motion-reduce:animate-none" size={25} />
          </div>
        ) : null}
        {item.remarks ? (
          <span className="bg-background/90 text-foreground absolute right-2 bottom-2 max-w-[calc(100%-1rem)] truncate rounded-md px-2 py-1 text-[11px] font-semibold shadow-sm backdrop-blur">
            {item.remarks}
          </span>
        ) : null}
      </div>
      <div className="mt-3 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-foreground min-w-0 flex-1 truncate text-[15px] font-bold">{item.title}</h3>
          <ChevronRight
            className="text-muted-foreground/50 shrink-0 transition-transform group-hover:translate-x-0.5"
            size={16}
          />
        </div>
        <p className="text-muted-foreground mt-1.5 truncate text-xs">{meta || item.sourceName}</p>
      </div>
    </button>
  )
}
