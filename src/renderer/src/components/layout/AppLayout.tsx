import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useMatches, useNavigate, useSearchParams } from 'react-router'
import {
  Check,
  ChevronsLeft,
  ChevronsRight,
  Clock3,
  Flame,
  Heart,
  Home,
  Info,
  Monitor,
  Moon,
  Search,
  Settings,
  Sun,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useThemeStore, type ThemeMode } from '@renderer/stores/theme'
import logoMarkUrl from '@renderer/assets/logo-mark.svg'

const primaryNavItems: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: '/', label: '首页', icon: Home },
  { to: '/hot', label: '近期热门', icon: Flame },
  { to: '/recent', label: '最近播放', icon: Clock3 },
  { to: '/favorites', label: '我的收藏', icon: Heart },
]

const themeItems: Array<{ mode: ThemeMode; label: string; icon: LucideIcon }> = [
  { mode: 'light', label: '明亮', icon: Sun },
  { mode: 'dark', label: '暗黑', icon: Moon },
  { mode: 'system', label: '跟随系统', icon: Monitor },
]

interface LayoutRouteHandle {
  hideTopBar?: boolean
  showGlobalSearch?: boolean
}

export function AppLayout(): React.JSX.Element {
  const matches = useMatches()
  const location = useLocation()
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const toggleSidebar = (): void => setIsSidebarCollapsed((current) => !current)
  const showGlobalSearch = matches.some((match) => {
    const handle = match.handle as LayoutRouteHandle | undefined
    return handle?.showGlobalSearch === true
  })
  const hideTopBar = matches.some((match) => {
    const handle = match.handle as LayoutRouteHandle | undefined
    return handle?.hideTopBar === true
  })

  return (
    <div
      className={cn(
        'bg-background text-foreground grid h-screen overflow-hidden transition-[grid-template-columns] duration-200',
        isSidebarCollapsed ? 'grid-cols-[76px_1fr]' : 'grid-cols-[252px_1fr]',
      )}
    >
      <aside
        className={cn(
          'border-sidebar-border bg-sidebar text-sidebar-foreground relative flex h-screen flex-col border-r py-4 transition-[padding] duration-200',
          isSidebarCollapsed ? 'px-2' : 'px-4',
        )}
      >
        <div className={cn('mb-4 flex items-center justify-center px-1', isSidebarCollapsed && 'justify-center px-0')}>
          <Logo collapsed={isSidebarCollapsed} />
        </div>

        <div
          aria-label={isSidebarCollapsed ? '双击展开侧边栏' : '双击收起侧边栏'}
          className="group absolute top-0 right-0 z-30 h-full w-5 translate-x-1/2 cursor-col-resize"
          role="separator"
          title={isSidebarCollapsed ? '双击展开侧边栏' : '双击收起侧边栏'}
          onDoubleClick={toggleSidebar}
        >
          <div className="bg-sidebar-border absolute top-0 right-1/2 h-full w-px translate-x-1/2 transform-gpu transition-transform duration-150 group-hover:scale-x-[3]" />
        </div>

        <button
          aria-label={isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          className="border-sidebar-border bg-background text-muted-foreground hover:bg-accent hover:text-primary focus-visible:ring-ring absolute top-1/2 right-0 z-40 flex size-9 translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm transition-colors outline-none focus-visible:ring-2"
          title={isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          type="button"
          onClick={toggleSidebar}
        >
          {isSidebarCollapsed ? <ChevronsRight size={17} /> : <ChevronsLeft size={17} />}
        </button>

        <nav className="flex flex-col gap-1.5">
          {primaryNavItems.map((item) => (
            <SidebarLink key={item.to} collapsed={isSidebarCollapsed} item={item} />
          ))}
        </nav>

        <nav className="mt-auto flex flex-col gap-1.5">
          <SidebarLink collapsed={isSidebarCollapsed} item={{ to: '/settings', label: '设置', icon: Settings }} />
          <SidebarLink collapsed={isSidebarCollapsed} item={{ to: '/about', label: '关于', icon: Info }} />
        </nav>
      </aside>

      <main className="relative h-screen min-w-0 overflow-y-auto">
        {hideTopBar ? null : <TopBar searchKey={location.search} showSearch={showGlobalSearch} />}
        <Outlet />
      </main>
    </div>
  )
}

function TopBar({ searchKey, showSearch }: { searchKey: string; showSearch: boolean }): React.JSX.Element {
  return (
    <header className="border-border bg-background/90 sticky top-0 z-30 flex h-[90px] items-center gap-5 border-b px-10 backdrop-blur">
      <div className="min-w-0 flex-1">{showSearch ? <LayoutSearchForm key={searchKey} /> : null}</div>
      <ThemeMenu />
    </header>
  )
}

function LayoutSearchForm(): React.JSX.Element {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const urlKeyword = searchParams.get('keyword') ?? ''
  const [keyword, setKeyword] = useState(urlKeyword)

  return (
    <form
      className="border-border bg-card mx-auto flex h-14 max-w-4xl items-center gap-3 rounded-xl border px-5 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault()
        openSearch(keyword, navigate)
      }}
    >
      <Search className="text-muted-foreground shrink-0" size={22} />
      <input
        aria-label="搜索片名"
        className="text-foreground placeholder:text-muted-foreground h-full min-w-0 flex-1 bg-transparent text-[15px] font-medium outline-none"
        placeholder="搜索电影、电视剧、综艺，支持演员、导演"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
      />
      <button
        className="bg-muted text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-xl px-3 py-1.5 text-xs font-semibold outline-none focus-visible:ring-2"
        type="submit"
      >
        搜索
      </button>
    </form>
  )
}

function Logo({ collapsed }: { collapsed: boolean }): React.JSX.Element {
  return (
    <NavLink
      aria-label="返回首页"
      className={cn(
        'focus-visible:ring-ring flex min-w-0 items-center gap-3 rounded-xl outline-none focus-visible:ring-2',
        collapsed && 'justify-center',
      )}
      title="返回首页"
      to="/"
    >
      <img alt="VfanTV" className="size-12 shrink-0" draggable={false} src={logoMarkUrl} />
      <div className={cn('min-w-0 transition-opacity duration-150', collapsed && 'hidden')}>
        <div className="text-sidebar-primary text-lg font-semibold tracking-wide">VfanTV</div>
        <div className="text-sidebar-foreground text-sm">影视聚合平台</div>
      </div>
    </NavLink>
  )
}

function SidebarLink({
  collapsed,
  item,
}: {
  collapsed: boolean
  item: { to: string; label: string; icon: LucideIcon }
}): React.JSX.Element {
  return (
    <NavLink
      end={item.to === '/'}
      title={collapsed ? item.label : undefined}
      to={item.to}
      className={({ isActive }) =>
        cn(
          'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex h-11 items-center rounded-xl text-sm font-medium transition-colors',
          collapsed ? 'justify-center px-0' : 'gap-3 px-3',
          isActive && 'bg-sidebar-accent text-sidebar-primary',
        )
      }
    >
      <item.icon size={17} />
      <span className={cn('truncate', collapsed && 'sr-only')}>{item.label}</span>
    </NavLink>
  )
}

function ThemeMenu(): React.JSX.Element {
  const mode = useThemeStore((state) => state.mode)
  const setMode = useThemeStore((state) => state.setMode)
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const ActiveIcon = themeItems.find((item) => item.mode === mode)?.icon ?? Monitor

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const closeMenu = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    window.addEventListener('mousedown', closeMenu)
    return () => window.removeEventListener('mousedown', closeMenu)
  }, [isOpen])

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        aria-label="切换主题"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="border-border bg-card text-muted-foreground hover:text-primary focus-visible:ring-ring flex size-10 items-center justify-center rounded-full border shadow-sm outline-none focus-visible:ring-2"
        type="button"
        onClick={() => setIsOpen((current) => !current)}
      >
        <ActiveIcon size={18} />
      </button>

      {isOpen ? (
        <div
          className="border-border bg-popover text-popover-foreground absolute right-0 mt-3 flex w-40 flex-col gap-1 rounded-xl border p-2 shadow-md"
          role="menu"
        >
          {themeItems.map((item) => (
            <button
              key={item.mode}
              aria-checked={mode === item.mode}
              className={cn(
                'text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring flex h-10 w-full items-center justify-between rounded-xl px-3 text-sm font-medium outline-none focus-visible:ring-2',
                mode === item.mode && 'bg-accent text-primary',
              )}
              role="menuitemradio"
              type="button"
              onClick={() => {
                setMode(item.mode)
                setIsOpen(false)
              }}
            >
              <span className="flex items-center gap-3">
                <item.icon className="shrink-0" size={17} />
                {item.label}
              </span>
              {mode === item.mode ? <Check className="shrink-0" size={17} strokeWidth={2} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function openSearch(keyword: string, navigate: ReturnType<typeof useNavigate>): void {
  const trimmedKeyword = keyword.trim()

  if (trimmedKeyword) {
    navigate(`/search?keyword=${encodeURIComponent(trimmedKeyword)}`)
  } else {
    navigate('/search')
  }
}
