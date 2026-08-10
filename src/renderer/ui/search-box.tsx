import { Search, X } from 'lucide-react'
import type { Ref } from 'react'
import { cn } from '@/utils'

export function SearchBox({
  ariaLabel,
  autoFocus = false,
  className,
  inputRef,
  onChange,
  onClear,
  onSubmit,
  placeholder,
  submitLabel = '搜索',
  value,
}: {
  ariaLabel: string
  autoFocus?: boolean
  className?: string
  inputRef?: Ref<HTMLInputElement>
  onChange: (value: string) => void
  onClear?: () => void
  onSubmit: () => void
  placeholder: string
  submitLabel?: string
  value: string
}): React.JSX.Element {
  return (
    <form
      className={cn(
        'border-border bg-card focus-within:border-primary/50 focus-within:ring-primary/10 flex h-12 w-full items-center gap-3 rounded-xl border px-4 shadow-sm transition-[border-color,box-shadow] focus-within:ring-4',
        className,
      )}
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <Search className="text-muted-foreground size-5 shrink-0" />
      <input
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        className="text-foreground placeholder:text-muted-foreground h-full min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
        placeholder={placeholder}
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && onClear ? (
        <button
          aria-label="清除搜索"
          className="text-muted-foreground hover:bg-primary/5 hover:text-foreground focus-visible:ring-ring flex size-8 shrink-0 items-center justify-center rounded-lg outline-none focus-visible:ring-2"
          type="button"
          onClick={onClear}
        >
          <X size={16} />
        </button>
      ) : null}
      <button
        className="text-primary hover:bg-primary/5 focus-visible:ring-ring shrink-0 rounded-lg px-2.5 py-2 text-sm font-semibold outline-none focus-visible:ring-2"
        type="submit"
      >
        {submitLabel}
      </button>
    </form>
  )
}
