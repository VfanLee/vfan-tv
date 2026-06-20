import type { HTMLAttributes } from 'react'
import { cn } from '@renderer/lib/utils'

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('bg-muted animate-pulse rounded-xl', className)} {...props} />
}
