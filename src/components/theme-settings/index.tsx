import { Clapperboard, Flame, Link, Radio } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/utils'
import { useLayoutPreferencesStore, type AppStyle, type ConfigurableNavigationItem } from '@/stores'
import { Switch } from '@/ui'
import { SettingsSection } from '../settings-card'

const styleItems: Array<{ style: AppStyle; label: string; description: string; icon: LucideIcon }> = [
  { style: 'catalog', label: '点播推荐', description: '从指定点播源浏览分类与影片', icon: Clapperboard },
  { style: 'trending', label: '热门推荐', description: '使用豆瓣数据发现近期热门内容', icon: Flame },
]

const navigationItems: Array<{
  key: ConfigurableNavigationItem
  label: string
  description: string
  icon: LucideIcon
}> = [
  { key: 'radio', label: '电台', description: '在顶部导航显示网络电台入口', icon: Radio },
  { key: 'linkPlayer', label: 'URL 解析播放', description: '在顶部导航显示 URL 解析播放入口', icon: Link },
]

export function LayoutPreferencesSettings(): React.JSX.Element {
  const appStyle = useLayoutPreferencesStore((state) => state.appStyle)
  const navigationVisibility = useLayoutPreferencesStore((state) => state.navigationVisibility)
  const setAppStyle = useLayoutPreferencesStore((state) => state.setAppStyle)
  const setNavigationVisible = useLayoutPreferencesStore((state) => state.setNavigationVisible)

  return (
    <div className="grid gap-8 [&>section+section]:border-t [&>section+section]:pt-8">
      <SettingsSection title="推荐内容">
        <div className="grid gap-3 sm:grid-cols-2">
          {styleItems.map((item) => {
            const active = appStyle === item.style
            return (
              <PreferenceOptionButton
                key={item.style}
                active={active}
                description={item.description}
                icon={item.icon}
                label={item.label}
                onClick={() => setAppStyle(item.style)}
              />
            )
          })}
        </div>
      </SettingsSection>

      <SettingsSection title="顶部导航">
        <div className="divide-border border-border divide-y border-y">
          {navigationItems.map((item) => (
            <label key={item.key} className="flex cursor-pointer items-center gap-4 py-4">
              <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                <item.icon size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{item.label}</span>
                <span className="text-muted-foreground mt-0.5 block text-sm">{item.description}</span>
              </span>
              <Switch
                checked={navigationVisibility[item.key]}
                onCheckedChange={(checked) => setNavigationVisible(item.key, checked)}
              />
            </label>
          ))}
        </div>
      </SettingsSection>
    </div>
  )
}

function PreferenceOptionButton({
  active,
  description,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  description: string
  icon: LucideIcon
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      aria-pressed={active}
      className={cn(
        'border-border bg-background hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring rounded-lg border p-4 text-left transition-colors outline-none focus-visible:ring-2',
        active && 'border-primary bg-accent text-primary',
      )}
      type="button"
      onClick={onClick}
    >
      <span className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5">
        <span className="bg-primary/10 text-primary row-span-2 flex size-10 items-center justify-center rounded-full">
          <Icon size={18} />
        </span>
        <span className="truncate font-semibold">{label}</span>
        <span className="text-muted-foreground col-start-2 row-start-2 truncate text-sm">{description}</span>
      </span>
    </button>
  )
}
