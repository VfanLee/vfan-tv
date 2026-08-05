import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty'
import { cn } from '@/utils'

type EmptyStateAction = {
  icon?: LucideIcon
  label: string
  onClick: () => void
  variant?: React.ComponentProps<typeof Button>['variant']
}

export function EmptyState({
  action,
  className,
  density = 'section',
  description,
  icon: Icon,
  iconClassName,
  secondaryAction,
  title,
}: {
  action?: EmptyStateAction
  className?: string
  density?: 'page' | 'section' | 'compact'
  description?: ReactNode
  icon?: LucideIcon
  iconClassName?: string
  secondaryAction?: EmptyStateAction
  title: string
}): React.JSX.Element {
  const hasActions = Boolean(action || secondaryAction)

  const content = (
    <Empty
      className={cn(
        density === 'page' && 'max-w-md flex-none py-10',
        density === 'section' && 'min-h-72 flex-none py-10',
        density === 'compact' && 'min-h-36 flex-none gap-3 py-6',
        className,
      )}
    >
      <EmptyHeader className={cn(density === 'compact' && 'max-w-none gap-1.5')}>
        {Icon ? (
          <EmptyMedia variant="icon">
            <Icon className={iconClassName} />
          </EmptyMedia>
        ) : null}
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {hasActions ? (
        <EmptyContent className="sm:flex-row sm:justify-center">
          {secondaryAction ? <ActionButton action={secondaryAction} /> : null}
          {action ? <ActionButton action={action} /> : null}
        </EmptyContent>
      ) : null}
    </Empty>
  )

  if (density === 'page') {
    return <div className="flex min-h-full items-center justify-center px-6 py-8">{content}</div>
  }

  return content
}

function ActionButton({ action }: { action: EmptyStateAction }): React.JSX.Element {
  const Icon = action.icon
  return (
    <Button variant={action.variant ?? 'default'} onClick={action.onClick}>
      {Icon ? <Icon data-icon="inline-start" /> : null}
      {action.label}
    </Button>
  )
}
