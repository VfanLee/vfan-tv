import { Check, Clapperboard, Flame, Link, Radio } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/utils'
import { useLayoutPreferencesStore, type AppStyle, type ConfigurableNavigationItem } from '@/stores'
import { Switch } from '@/ui'
import { SettingsCard } from '../settings-card'

const styleItems: Array<{ style: AppStyle; label: string; description: string; icon: LucideIcon }> = [
  { style: 'catalog', label: '资源库', description: '从指定点播源浏览分类与影片', icon: Clapperboard },
  { style: 'trending', label: '豆瓣热门', description: '使用豆瓣数据发现近期热门内容', icon: Flame },
]

const navigationItems: Array<{
  key: ConfigurableNavigationItem
  label: string
  description: string
  icon: LucideIcon
}> = [
  { key: 'radio', label: '电台', description: '在顶部导航显示网络电台入口', icon: Radio },
  { key: 'linkPlayer', label: '直链播放', description: '在顶部导航显示直链播放入口', icon: Link },
]

export function LayoutPreferencesSettings(): React.JSX.Element {
  const appStyle = useLayoutPreferencesStore((state) => state.appStyle)
  const navigationVisibility = useLayoutPreferencesStore((state) => state.navigationVisibility)
  const setAppStyle = useLayoutPreferencesStore((state) => state.setAppStyle)
  const setNavigationVisible = useLayoutPreferencesStore((state) => state.setNavigationVisible)

  return (
    <div className="grid gap-5">
      <SettingsCard description="选择首页内容与主导航结构。" title="应用风格">
        <div className="grid gap-3 p-5 sm:grid-cols-2">
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
      </SettingsCard>

      <SettingsCard description="选择可选的顶部导航入口。" title="主导航显示">
        <div className="divide-border divide-y px-5">
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
      </SettingsCard>
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
        'border-border bg-background hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring rounded-xl border p-4 text-left transition-colors outline-none focus-visible:ring-2',
        active && 'border-primary bg-accent text-primary',
      )}
      type="button"
      onClick={onClick}
    >
      <span className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5">
        <span className="bg-primary/10 text-primary row-span-2 flex size-10 items-center justify-center rounded-full">
          <Icon size={18} />
        </span>
        <span className="truncate font-semibold">{label}</span>
        {active ? <Check className="col-start-3 row-start-1 shrink-0" size={18} strokeWidth={2} /> : null}
        <span className="text-muted-foreground col-start-2 row-start-2 truncate text-sm">{description}</span>
      </span>
    </button>
  )
}
