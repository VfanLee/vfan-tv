import type { ReactNode } from 'react'
import { Card } from '@/ui/card'

interface SettingsCardProps {
  children: ReactNode
  description: string
  headerActions?: ReactNode
  title: string
}

export function SettingsCard({ children, description, headerActions, title }: SettingsCardProps): React.JSX.Element {
  return (
    <Card className="overflow-hidden">
      <div className="border-border flex flex-wrap items-start justify-between gap-4 border-b px-5 py-5">
        <div>
          <h2 className="text-foreground text-lg font-semibold">{title}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{description}</p>
        </div>
        {headerActions}
      </div>

      {children}
    </Card>
  )
}
