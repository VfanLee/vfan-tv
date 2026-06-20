import { Check, Monitor, Moon, Sun } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card } from '@renderer/components'
import { cn } from '@renderer/lib/utils'
import { useThemeStore, type ThemeMode } from '@renderer/stores/theme'

const themeItems: Array<{ mode: ThemeMode; label: string; description: string; icon: LucideIcon }> = [
  { mode: 'light', label: '明亮', description: '始终使用浅色界面', icon: Sun },
  { mode: 'dark', label: '暗黑', description: '始终使用深色界面', icon: Moon },
  { mode: 'system', label: '跟随系统', description: '自动匹配系统外观', icon: Monitor },
]

export function ThemeSettings(): React.JSX.Element {
  const mode = useThemeStore((state) => state.mode)
  const setMode = useThemeStore((state) => state.setMode)

  return (
    <Card className="overflow-hidden">
      <div className="border-border border-b px-5 py-5">
        <h2 className="text-foreground text-lg font-semibold">外观主题</h2>
        <p className="text-muted-foreground mt-1 text-sm">选择应用的明亮、暗黑或跟随系统主题。</p>
      </div>

      <div className="grid gap-3 p-5 sm:grid-cols-3">
        {themeItems.map((item) => {
          const active = mode === item.mode

          return (
            <button
              key={item.mode}
              aria-pressed={active}
              className={cn(
                'border-border bg-background hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring rounded-xl border p-4 text-left transition-colors outline-none focus-visible:ring-2',
                active && 'border-primary bg-accent text-primary',
              )}
              type="button"
              onClick={() => setMode(item.mode)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-full">
                  <item.icon size={18} />
                </div>
                {active ? <Check className="shrink-0" size={18} strokeWidth={2} /> : null}
              </div>
              <div className="mt-4 font-semibold">{item.label}</div>
              <p className="text-muted-foreground mt-1 text-sm">{item.description}</p>
            </button>
          )
        })}
      </div>
    </Card>
  )
}
