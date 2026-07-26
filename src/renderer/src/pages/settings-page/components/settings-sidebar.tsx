import { cn } from '@/utils'
import { settingsSections, type SettingsSectionId } from '../settings-sections'

export function SettingsSidebar({
  activeSection,
  onSelect,
}: {
  activeSection: SettingsSectionId
  onSelect: (sectionId: SettingsSectionId) => void
}): React.JSX.Element {
  return (
    <aside className="sticky top-8 min-w-0 self-start">
      <h1 className="text-foreground mb-6 px-3 text-2xl font-semibold tracking-tight">设置</h1>
      <nav aria-label="设置分类" className="flex flex-col gap-1">
        {settingsSections.map((section) => {
          const active = section.id === activeSection
          return (
            <button
              key={section.id}
              aria-current={active ? 'location' : undefined}
              className={cn(
                'focus-visible:ring-ring relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2',
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                active &&
                  'before:bg-primary before:absolute before:top-2 before:bottom-2 before:left-0 before:w-0.5 before:rounded-full',
              )}
              type="button"
              onClick={() => onSelect(section.id)}
            >
              <section.icon aria-hidden className="size-4 shrink-0" />
              {section.label}
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
