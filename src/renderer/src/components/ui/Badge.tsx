import type { HTMLAttributes } from 'react'
import { cn } from '@renderer/lib/utils'

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  return (
    <span
      className={cn(
        'bg-secondary text-secondary-foreground inline-flex items-center justify-center rounded-md border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors',
        className,
      )}
      {...props}
    />
  )
}
