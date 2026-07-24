import type { ComponentType } from 'react'
import { cn } from '@/utils'

type TabValue = string | number

export interface SegmentedTabItem<T extends TabValue> {
  value: T
  label: string
  icon?: ComponentType<{ size?: number }>
}

export function SegmentedTabs<T extends TabValue>({
  ariaLabel,
  className,
  equalWidth = false,
  items,
  onValueChange,
  value,
}: {
  ariaLabel: string
  className?: string
  equalWidth?: boolean
  items: readonly SegmentedTabItem<T>[]
  onValueChange: (value: T) => void
  value: T
}): React.JSX.Element {
  return (
    <div
      aria-label={ariaLabel}
      className={cn(
        'border-border/70 bg-card/80 flex w-fit items-center gap-1 rounded-xl border p-1 shadow-sm backdrop-blur-md',
        className,
      )}
      role="tablist"
    >
      {items.map((item) => {
        const active = item.value === value
        const Icon = item.icon

        return (
          <button
            key={item.value}
            aria-selected={active}
            className={cn(
              'focus-visible:ring-primary/40 inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium outline-none transition-[color,background-color,box-shadow] focus-visible:ring-2',
              active
                ? 'bg-primary/10 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.16)]'
                : 'text-muted-foreground hover:bg-primary/5 hover:text-foreground',
              equalWidth && 'min-w-0 flex-1',
            )}
            role="tab"
            type="button"
            onClick={() => onValueChange(item.value)}
          >
            {Icon ? <Icon size={17} /> : null}
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
