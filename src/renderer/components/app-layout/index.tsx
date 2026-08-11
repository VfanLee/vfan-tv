import { useLayoutEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { Check, Clock3, Heart, Monitor, Moon, Search, Settings, Sun } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/utils'
import logoMarkUrl from '@renderer/assets/logo-mark.svg'
import applicationBackgroundUrl from '@renderer/assets/application-background.png'
import applicationBackgroundDarkUrl from '@renderer/assets/application-background-dark.png'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui'
import { openSettingsWindow } from '@renderer/platform/api'
import { RadioBottomPlayer } from '../radio-player'
import { useAppUpdateStore, useLayoutPreferencesStore, useThemeStore, type ThemeMode } from '@/stores'

const themeOptions: Array<{ mode: ThemeMode; label: string; icon: LucideIcon }> = [
  { mode: 'system', label: '跟随系统', icon: Monitor },
  { mode: 'light', label: '明亮', icon: Sun },
  { mode: 'dark', label: '暗黑', icon: Moon },
]

export function AppLayout(): React.JSX.Element {
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const navigationVisibility = useLayoutPreferencesStore((state) => state.navigationVisibility)
  const showRadioBottomPlayer = location.pathname === '/radio'

  useLayoutEffect(() => {
    const main = mainRef.current
    if (!main) return
    main.scrollTop = 0
    main.scrollLeft = 0
  }, [location.key])

  return (
    <div className="bg-background text-foreground flex h-screen flex-col overflow-hidden" data-app-shell>
      <AppHeader linkPlayerVisible={navigationVisibility.linkPlayer} radioVisible={navigationVisibility.radio} />

      <section className="bg-background relative isolate min-h-0 min-w-0 flex-1 overflow-hidden" data-app-content-shell>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-cover bg-fixed bg-center dark:hidden"
          data-app-content-background
          style={{ backgroundImage: `url(${applicationBackgroundUrl})` }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 hidden bg-cover bg-fixed bg-center dark:block"
          data-app-content-background
          style={{ backgroundImage: `url(${applicationBackgroundDarkUrl})` }}
        />
        <div
          aria-hidden="true"
          className="bg-background/5 dark:bg-background/10 pointer-events-none absolute inset-0 -z-10"
          data-app-content-background
        />
        <main ref={mainRef} className={cn('relative h-full min-w-0 overflow-y-auto', showRadioBottomPlayer && 'pb-28')}>
          <Outlet />
        </main>
        {showRadioBottomPlayer ? <RadioBottomPlayer /> : null}
      </section>
    </div>
  )
}

function AppHeader({
  linkPlayerVisible,
  radioVisible,
}: {
  linkPlayerVisible: boolean
  radioVisible: boolean
}): React.JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()
  const updateAvailable = useAppUpdateStore((state) => state.result?.updateAvailable === true)
  const mainNavItems = [
    { to: '/', label: '推荐' },
    { to: '/iptv', label: 'IPTV' },
    ...(radioVisible ? [{ to: '/radio', label: '电台' }] : []),
    ...(linkPlayerVisible ? [{ to: '/link-player', label: 'URL 解析播放' }] : []),
  ]

  const openSearch = (): void => {
    if (location.pathname !== '/search' || location.search) {
      navigate('/search')
      return
    }
    window.dispatchEvent(new CustomEvent('vfan-tv:focus-search'))
  }

  return (
    <header className="border-border bg-background/92 relative z-40 grid h-[76px] shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center border-b px-4 backdrop-blur-xl sm:px-6 lg:px-10">
      <NavLink
        aria-label="返回推荐"
        className="focus-visible:ring-ring flex min-w-0 items-center gap-2.5 rounded-xl outline-none focus-visible:ring-2"
        title="返回推荐"
        to="/"
      >
        <img alt="Vfan TV" className="size-11 shrink-0" draggable={false} src={logoMarkUrl} />
        <span className="text-primary hidden text-lg font-bold tracking-wide md:block">Vfan TV</span>
      </NavLink>

      <nav aria-label="主导航" className="flex min-w-0 items-center justify-center gap-1 sm:gap-2">
        {mainNavItems.map((item) => (
          <HeaderNavLink key={item.to} item={item} />
        ))}
      </nav>

      <nav aria-label="快捷操作" className="flex items-center justify-end gap-0.5 sm:gap-1">
        <HeaderIconButton active={location.pathname === '/search'} icon={Search} label="搜索" onClick={openSearch} />
        <HeaderIconLink active={location.pathname === '/recent'} icon={Clock3} label="最近播放" to="/recent" />
        <HeaderIconLink active={location.pathname === '/favorites'} icon={Heart} label="我的收藏" to="/favorites" />
        <span className="relative">
          <HeaderIconButton active={false} icon={Settings} label="设置" onClick={() => void openSettingsWindow()} />
          {updateAvailable ? (
            <span
              aria-label="发现新版本"
              className="bg-primary ring-background pointer-events-none absolute top-1.5 right-1.5 size-2 rounded-full ring-2"
            />
          ) : null}
        </span>
        <ThemeMenu />
      </nav>
    </header>
  )
}

function HeaderNavLink({ item }: { item: { to: string; label: string } }): React.JSX.Element {
  return (
    <NavLink
      end={item.to === '/'}
      to={item.to}
      className={({ isActive }) =>
        cn(
          'focus-visible:ring-ring relative flex h-10 shrink-0 items-center gap-2 rounded-lg px-2.5 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 sm:px-4',
          isActive ? 'text-primary' : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
          'after:bg-primary after:absolute after:right-3 after:bottom-0 after:left-3 after:h-0.5 after:origin-center after:rounded-full after:transition-transform',
          isActive ? 'after:scale-x-100' : 'after:scale-x-0',
        )
      }
    >
      <span>{item.label}</span>
    </NavLink>
  )
}

function HeaderIconLink({
  active,
  icon: Icon,
  label,
  to,
}: {
  active: boolean
  icon: LucideIcon
  label: string
  to: string
}): React.JSX.Element {
  return (
    <NavLink
      aria-label={label}
      className={cn(
        'focus-visible:ring-ring flex size-10 items-center justify-center rounded-xl transition-colors outline-none focus-visible:ring-2',
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
      title={label}
      to={to}
    >
      <Icon size={18} />
    </NavLink>
  )
}

function HeaderIconButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  icon: LucideIcon
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      aria-label={label}
      className={cn(
        'focus-visible:ring-ring flex size-10 items-center justify-center rounded-xl transition-colors outline-none focus-visible:ring-2',
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
      title={label}
      type="button"
      onClick={onClick}
    >
      <Icon size={18} />
    </button>
  )
}

function ThemeMenu(): React.JSX.Element {
  const mode = useThemeStore((state) => state.mode)
  const setMode = useThemeStore((state) => state.setMode)
  const activeOption = themeOptions.find((option) => option.mode === mode) ?? themeOptions[0]
  const ActiveIcon = activeOption.icon

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={`主题：${activeOption.label}`}
          className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring flex size-10 items-center justify-center rounded-xl transition-colors outline-none focus-visible:ring-2"
          title={`主题：${activeOption.label}`}
          type="button"
        >
          <ActiveIcon size={18} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-40 gap-1 p-1.5" sideOffset={8}>
        {themeOptions.map((option) => {
          const Icon = option.icon
          const active = option.mode === mode
          return (
            <button
              key={option.mode}
              className={cn(
                'focus-visible:ring-ring flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2',
                active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
              type="button"
              onClick={() => setMode(option.mode)}
            >
              <Icon size={17} />
              <span>{option.label}</span>
              {active ? <Check className="ml-auto" size={16} /> : null}
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
