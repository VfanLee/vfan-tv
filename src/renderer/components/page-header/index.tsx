import type { ReactNode } from 'react'
import { cn } from '@/utils'

export function PageHeader({
  actions,
  className,
  description,
  title,
}: {
  actions?: ReactNode
  className?: string
  description?: string
  title: string
}): React.JSX.Element {
  return (
    <header className={cn('mb-7 flex min-h-11 flex-wrap items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-muted-foreground mt-1.5 text-sm">{description}</p> : null}
      </div>
      {actions}
    </header>
  )
}
