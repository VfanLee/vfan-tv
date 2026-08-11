import type { ReactNode } from 'react'
import { cn } from '@/utils'

interface SettingsPageLayoutProps {
  children: ReactNode
  className?: string
  description: string
  headerActions?: ReactNode
  title: string
}

interface SettingsSectionProps {
  children: ReactNode
  className?: string
  description: string
  headerActions?: ReactNode
  id?: string
  title: string
}

export function SettingsPageLayout({
  children,
  className,
  description,
  headerActions,
  title,
}: SettingsPageLayoutProps): React.JSX.Element {
  return (
    <div className={cn('mx-auto w-full max-w-[1240px]', className)}>
      <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-foreground text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-muted-foreground mt-1.5 max-w-3xl text-sm leading-6">{description}</p>
        </div>
        {headerActions}
      </header>

      {children}
    </div>
  )
}

export function SettingsSection({
  children,
  className,
  description,
  headerActions,
  id,
  title,
}: SettingsSectionProps): React.JSX.Element {
  return (
    <section className={cn('min-w-0 scroll-mt-20', className)} id={id}>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-foreground text-lg font-semibold tracking-tight">{title}</h2>
          <p className="text-muted-foreground mt-1 text-sm leading-6">{description}</p>
        </div>
        {headerActions}
      </header>

      {children}
    </section>
  )
}

// 兼容尚未迁移的调用方；设置页新代码应使用 SettingsSection。
export const SettingsCard = SettingsSection
