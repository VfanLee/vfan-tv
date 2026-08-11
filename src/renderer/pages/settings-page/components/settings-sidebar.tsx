import { cn } from '@/utils'
import { settingsSections, type SettingsPageDefinition, type SettingsSectionId } from '../settings-sections'

/** 渲染设置侧边栏 */
export function SettingsSidebar({
  activeSection,
  onSelect,
}: {
  activeSection: SettingsSectionId
  onSelect: (sectionId: SettingsSectionId) => void
}): React.JSX.Element {
  return (
    <aside className="sticky top-5 min-w-0 self-start xl:top-8">
      <h1 className="text-foreground mb-5 px-2 text-2xl font-semibold tracking-tight">设置</h1>
      <nav aria-label="设置分类" className="flex flex-col gap-1">
        {settingsSections.map((page) => (
          <SettingsNavigationButton active={page.id === activeSection} key={page.id} page={page} onSelect={onSelect} />
        ))}
      </nav>
    </aside>
  )
}

/** 渲染设置导航按钮 */
function SettingsNavigationButton({
  active,
  page,
  onSelect,
}: {
  active: boolean
  page: SettingsPageDefinition
  onSelect: (sectionId: SettingsSectionId) => void
}): React.JSX.Element {
  return (
    <button
      aria-current={active ? 'page' : undefined}
      className={cn(
        'focus-visible:ring-ring relative flex w-full items-center gap-2 rounded-lg px-2 py-2.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2',
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        active &&
          'before:bg-primary before:absolute before:top-2 before:bottom-2 before:left-0 before:w-0.5 before:rounded-full',
      )}
      type="button"
      onClick={() => onSelect(page.id)}
    >
      <page.icon aria-hidden className="size-4 shrink-0" />
      {page.label}
    </button>
  )
}
