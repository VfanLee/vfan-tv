import type { ReactNode } from 'react'
import { cn } from '@/utils'

interface SettingsPageLayoutProps {
  children: ReactNode
  className?: string
  headerActions?: ReactNode
  title: string
}

interface SettingsSectionProps {
  children: ReactNode
  className?: string
  description?: string
  headerActions?: ReactNode
  id?: string
  title: string
}

export function SettingsPageLayout({
  children,
  className,
  headerActions,
  title,
}: SettingsPageLayoutProps): React.JSX.Element {
  return (
    <div className={cn('mx-auto w-full max-w-[1240px]', className)}>
      <header className="mb-6 flex min-h-9 flex-wrap items-center justify-between gap-4">
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">{title}</h1>
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
      <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-foreground text-base font-semibold">{title}</h2>
          {description ? <p className="text-muted-foreground mt-1 text-sm leading-6">{description}</p> : null}
        </div>
        {headerActions}
      </header>

      {children}
    </section>
  )
}

// 兼容已有调用方；设置页新代码应使用 SettingsSection。
export const SettingsCard = SettingsSection
