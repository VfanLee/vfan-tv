import { Clock3, X } from 'lucide-react'

export function SearchHistory({
  histories,
  onClear,
  onPick,
  onRemove,
}: {
  histories: string[]
  onClear: () => void
  onPick: (history: string) => void
  onRemove: (history: string) => void
}): React.JSX.Element {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-foreground text-base font-semibold">搜索历史</h2>
        <button
          className="text-muted-foreground hover:text-destructive focus-visible:ring-ring text-sm font-medium outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={histories.length === 0}
          type="button"
          onClick={onClear}
        >
          清空
        </button>
      </div>
      {histories.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {histories.map((history) => (
            <span
              key={history}
              className="group border-border bg-card text-muted-foreground inline-flex h-11 max-w-full items-center gap-2 rounded-xl border pr-1.5 pl-4 text-sm font-medium shadow-sm"
            >
              <Clock3 className="text-muted-foreground shrink-0" size={17} />
              <button
                className="hover:text-primary focus-visible:ring-ring max-w-64 truncate outline-none focus-visible:ring-2"
                type="button"
                onClick={() => onPick(history)}
              >
                {history}
              </button>
              <button
                aria-label={`删除 ${history}`}
                className="text-muted-foreground hover:bg-muted hover:text-destructive focus-visible:ring-ring flex size-8 items-center justify-center rounded-xl outline-none focus-visible:ring-2"
                type="button"
                onClick={() => onRemove(history)}
              >
                <X size={15} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="border-input text-muted-foreground rounded-xl border border-dashed px-4 py-6 text-center text-sm">
          搜过的关键词会保存在这里。
        </p>
      )}
    </section>
  )
}
