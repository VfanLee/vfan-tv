import { useLayoutEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useMatches, useNavigate, useSearchParams } from 'react-router'
import { ChevronLeft, ChevronRight, Clock3, Heart, Home, Info, Link, Search, Settings, Tv } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SIDEBAR_COLLAPSED_STORAGE_KEY } from '@shared/constants'
import { categoryIcons } from '@renderer/constants'
import { cn } from '@/utils'
import logoMarkUrl from '@renderer/assets/logo-mark.svg'

const primaryNavItems: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: '/', label: '首页', icon: Home },
  { to: '/live', label: '直播', icon: Tv },
  { to: '/hot/movie', label: '电影', icon: categoryIcons.movie },
  { to: '/hot/tv', label: '电视剧', icon: categoryIcons.tv },
  { to: '/hot/animation', label: '动画', icon: categoryIcons.animation },
  { to: '/hot/documentary', label: '纪录片', icon: categoryIcons.documentary },
  { to: '/hot/show', label: '综艺', icon: categoryIcons.show },
  { to: '/link-player', label: '直链播放', icon: Link },
]

const secondaryNavItems: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: '/recent', label: '最近播放', icon: Clock3 },
  { to: '/favorites', label: '我的收藏', icon: Heart },
  { to: '/settings', label: '设置', icon: Settings },
  { to: '/about', label: '关于', icon: Info },
]

interface LayoutRouteHandle {
  hideTopBar?: boolean
  showGlobalSearch?: boolean
}

export function AppLayout(): React.JSX.Element {
  const matches = useMatches()
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => readSidebarCollapsed())
  const toggleSidebar = (): void => {
    setIsSidebarCollapsed((current) => {
      const next = !current
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next))
      return next
    })
  }
  const showGlobalSearch = matches.some((match) => {
    const handle = match.handle as LayoutRouteHandle | undefined
    return handle?.showGlobalSearch === true
  })
  const hideTopBar = matches.some((match) => {
    const handle = match.handle as LayoutRouteHandle | undefined
    return handle?.hideTopBar === true
  })

  useLayoutEffect(() => {
    const main = mainRef.current
    if (main) {
      main.scrollTop = 0
      main.scrollLeft = 0
    }
  }, [location.key])

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
          {isSidebarCollapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
        </button>

        <nav className="flex flex-col gap-1.5">
          {primaryNavItems.map((item) => (
            <SidebarLink key={item.to} collapsed={isSidebarCollapsed} item={item} />
          ))}
        </nav>

        <nav className="mt-auto flex flex-col gap-1.5">
          {secondaryNavItems.map((item) => (
            <SidebarLink key={item.to} collapsed={isSidebarCollapsed} item={item} />
          ))}
        </nav>
      </aside>

      <main ref={mainRef} className="relative h-screen min-w-0 overflow-y-auto">
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
        placeholder="搜索电影、电视剧、动画、纪录片、综艺"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
      />
      <button
        className="bg-muted text-muted-foreground border-border/80 hover:bg-muted/80 hover:text-foreground focus-visible:ring-ring cursor-pointer rounded-xl border px-5 py-2.5 text-sm font-semibold shadow-[0_1px_0_0_rgba(255,255,255,0.55)_inset,0_2px_5px_rgba(0,0,0,0.08)] transition-[transform,box-shadow,background-color,color] duration-150 outline-none hover:shadow-[0_1px_0_0_rgba(255,255,255,0.7)_inset,0_3px_8px_rgba(0,0,0,0.1)] focus-visible:ring-2 active:translate-y-px active:shadow-[0_1px_0_0_rgba(255,255,255,0.35)_inset,0_1px_2px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset,0_2px_5px_rgba(0,0,0,0.35)] dark:hover:shadow-[0_1px_0_0_rgba(255,255,255,0.12)_inset,0_3px_8px_rgba(0,0,0,0.4)] dark:active:shadow-[0_1px_0_0_rgba(255,255,255,0.05)_inset,0_1px_2px_rgba(0,0,0,0.3)]"
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
        'focus-visible:ring-ring flex min-w-0 items-center gap-2 rounded-xl outline-none focus-visible:ring-2',
        collapsed && 'justify-center',
      )}
      title="返回首页"
      to="/"
    >
      <img alt="Vfan TV" className="size-14 shrink-0" draggable={false} src={logoMarkUrl} />
      <div className={cn('min-w-0 transition-opacity duration-150', collapsed && 'hidden')}>
        <div className="text-sidebar-primary text-xl font-semibold tracking-wide">Vfan TV</div>
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
          'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex h-11 items-center rounded-xl font-medium transition-colors',
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

function openSearch(keyword: string, navigate: ReturnType<typeof useNavigate>): void {
  const trimmedKeyword = keyword.trim()

  if (trimmedKeyword) {
    navigate(`/search?keyword=${encodeURIComponent(trimmedKeyword)}`)
  } else {
    navigate('/search')
  }
}

function readSidebarCollapsed(): boolean {
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
}
