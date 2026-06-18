import type { HTMLAttributes } from 'react'
import { cn } from '@renderer/lib/utils'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn('border-border bg-card text-card-foreground rounded-xl border shadow-sm', className)}
      {...props}
    />
  )
}
