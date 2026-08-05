import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useMatches, useNavigate, useSearchParams } from 'react-router'
import { ChevronLeft, ChevronRight, Clock3, Heart, Home, Link, MonitorPlay, Radio, Settings } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SIDEBAR_COLLAPSED_STORAGE_KEY } from '@shared/constants'
import { categoryIcons } from '@renderer/constants'
import { SearchBox } from '@/ui'
import { cn } from '@/utils'
import logoMarkUrl from '@renderer/assets/logo-mark.svg'
import applicationBackgroundUrl from '@renderer/assets/application-background.png'
import applicationBackgroundDarkUrl from '@renderer/assets/application-background-dark.png'
import sidebarBackgroundUrl from '@renderer/assets/sidebar-background.png'
import sidebarBackgroundDarkUrl from '@renderer/assets/sidebar-background-dark.png'
import { RadioBottomPlayer } from '../radio-player'
import { SidebarUpdateButton } from '../sidebar-update-button'
import { useAppUpdateStore, useAppUpdateSync, useLayoutPreferencesStore } from '@/stores'

// 应用级壳层维护导航、顶部栏、主内容滚动状态，以及仅在电台页常驻的底部播放器容器。
const homeNavItem = { to: '/', label: '首页', icon: Home }
const trendingNavItems: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: '/hot/movie', label: '电影', icon: categoryIcons.movie },
  { to: '/hot/tv', label: '电视剧', icon: categoryIcons.tv },
  { to: '/hot/animation', label: '动画', icon: categoryIcons.animation },
  { to: '/hot/documentary', label: '纪录片', icon: categoryIcons.documentary },
  { to: '/hot/show', label: '综艺', icon: categoryIcons.show },
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
  const appStyle = useLayoutPreferencesStore((state) => state.appStyle)
  const navigationVisibility = useLayoutPreferencesStore((state) => state.navigationVisibility)
  const isCompactWindow = useMediaQuery('(max-width: 1279px)')
  const isSidebarCompact = isSidebarCollapsed || isCompactWindow
  const showRadioBottomPlayer = location.pathname === '/radio'
  const toggleSidebar = (): void => {
    setIsSidebarCollapsed((current) => {
      const next = !current
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next))
      return next
    })
  }
  const showGlobalSearch =
    location.pathname === '/' ||
    matches.some((match) => {
      const handle = match.handle as LayoutRouteHandle | undefined
      return handle?.showGlobalSearch === true
    })
  const hideTopBar = matches.some((match) => {
    const handle = match.handle as LayoutRouteHandle | undefined
    return handle?.hideTopBar === true
  })
  const primaryNavItems = [
    homeNavItem,
    ...(appStyle === 'trending' ? trendingNavItems : []),
    { to: '/live', label: '直播', icon: MonitorPlay },
    ...(navigationVisibility.radio ? [{ to: '/radio', label: '电台', icon: Radio }] : []),
    ...(navigationVisibility.linkPlayer ? [{ to: '/link-player', label: '直链播放', icon: Link }] : []),
  ]
  const secondaryNavItems = [
    ...(navigationVisibility.recent ? [{ to: '/recent', label: '最近播放', icon: Clock3 }] : []),
    ...(navigationVisibility.favorites ? [{ to: '/favorites', label: '我的收藏', icon: Heart }] : []),
  ]
  const settingsNavItem = { to: '/settings', label: '设置', icon: Settings }
  const updateAvailable = useAppUpdateStore((state) => state.result?.updateAvailable === true)

  useAppUpdateSync()

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
        isSidebarCompact ? 'grid-cols-[76px_1fr]' : 'grid-cols-[252px_1fr]',
      )}
    >
      <aside
        className={cn(
          'border-sidebar-border bg-sidebar text-sidebar-foreground relative isolate z-20 flex h-screen flex-col border-r py-4 transition-[padding] duration-200',
          isSidebarCompact ? 'px-2' : 'px-4',
        )}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-cover bg-center dark:hidden"
          style={{ backgroundImage: `url(${sidebarBackgroundUrl})` }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 hidden bg-cover bg-center dark:block"
          style={{ backgroundImage: `url(${sidebarBackgroundDarkUrl})` }}
        />
        <div className={cn('mb-4 flex items-center justify-center px-1', isSidebarCompact && 'justify-center px-0')}>
          <Logo collapsed={isSidebarCompact} />
        </div>

        <div
          aria-label={isSidebarCompact ? '双击展开侧边栏' : '双击收起侧边栏'}
          className="group absolute top-0 right-0 z-30 hidden h-full w-5 translate-x-1/2 cursor-col-resize xl:block"
          role="separator"
          title={isSidebarCompact ? '双击展开侧边栏' : '双击收起侧边栏'}
          onDoubleClick={toggleSidebar}
        >
          <div className="bg-sidebar-border absolute top-0 right-1/2 h-full w-px translate-x-1/2 transform-gpu transition-transform duration-150 group-hover:scale-x-[3]" />
        </div>

        <button
          aria-label={isSidebarCompact ? '展开侧边栏' : '收起侧边栏'}
          className="border-sidebar-border bg-background text-muted-foreground hover:bg-accent hover:text-primary focus-visible:ring-ring absolute top-1/2 right-0 z-40 hidden size-9 translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm transition-colors outline-none focus-visible:ring-2 xl:flex"
          title={isSidebarCompact ? '展开侧边栏' : '收起侧边栏'}
          type="button"
          onClick={toggleSidebar}
        >
          {isSidebarCompact ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
        </button>

        <nav className="flex flex-col gap-1.5">
          {primaryNavItems.map((item) => (
            <SidebarLink key={item.to} collapsed={isSidebarCompact} item={item} />
          ))}
        </nav>

        <nav className="mt-auto flex flex-col gap-1.5">
          {secondaryNavItems.map((item) => (
            <SidebarLink key={item.to} collapsed={isSidebarCompact} item={item} />
          ))}
          <div className="relative">
            <SidebarLink
              className={cn('w-full', updateAvailable && !isSidebarCompact && 'pr-11')}
              collapsed={isSidebarCompact}
              item={settingsNavItem}
            />
            <SidebarUpdateButton collapsed={isSidebarCompact} />
          </div>
        </nav>
      </aside>

      <section className="bg-background relative isolate z-0 h-screen min-w-0 overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-cover bg-fixed bg-center dark:hidden"
          style={{ backgroundImage: `url(${applicationBackgroundUrl})` }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 hidden bg-cover bg-fixed bg-center dark:block"
          style={{ backgroundImage: `url(${applicationBackgroundDarkUrl})` }}
        />
        <div
          aria-hidden="true"
          className="bg-background/5 dark:bg-background/10 pointer-events-none absolute inset-0 -z-10"
        />
        <main
          ref={mainRef}
          className={cn(
            'relative h-screen min-w-0 overflow-y-auto transition-[padding] duration-150 motion-reduce:transition-none',
            showRadioBottomPlayer && 'pb-28',
          )}
        >
          {hideTopBar ? null : <TopBar searchKey={location.search} showSearch={showGlobalSearch} />}
          <Outlet />
        </main>
        {showRadioBottomPlayer ? <RadioBottomPlayer /> : null}
      </section>
    </div>
  )
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const mediaQuery = window.matchMedia(query)
    const updateMatches = (): void => setMatches(mediaQuery.matches)

    updateMatches()
    mediaQuery.addEventListener('change', updateMatches)
    return () => mediaQuery.removeEventListener('change', updateMatches)
  }, [query])

  return matches
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
    <SearchBox
      ariaLabel="全局搜索"
      placeholder="搜你想搜"
      submitLabel="全局搜索"
      value={keyword}
      onChange={setKeyword}
      onClear={() => setKeyword('')}
      onSubmit={() => openSearch(keyword, navigate)}
    />
  )
}

function Logo({ collapsed }: { collapsed: boolean }): React.JSX.Element {
  return (
    <NavLink
      aria-label="返回首页"
      className={cn(
        'focus-visible:ring-ring flex min-w-0 items-center gap-3 rounded-xl outline-none focus-visible:ring-2',
        collapsed && 'justify-center gap-0',
      )}
      title="返回首页"
      to="/"
    >
      <img alt="Vfan TV" className="size-16 shrink-0" draggable={false} src={logoMarkUrl} />
      <div className={cn('min-w-0 transition-opacity duration-150', collapsed && 'hidden')}>
        <div className="text-sidebar-primary text-2xl font-semibold tracking-wide">Vfan TV</div>
        <div className="text-sidebar-foreground mt-0.5 text-sm">影视聚合客户端</div>
      </div>
    </NavLink>
  )
}

function SidebarLink({
  className,
  collapsed,
  item,
}: {
  className?: string
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
          'flex h-11 items-center rounded-xl font-medium transition-colors',
          collapsed ? 'justify-center px-0' : 'gap-3 px-3',
          isActive
            ? 'bg-sidebar-accent text-sidebar-primary'
            : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
          className,
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

  if (!trimmedKeyword) return
  navigate(`/search?keyword=${encodeURIComponent(trimmedKeyword)}`)
}

function readSidebarCollapsed(): boolean {
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
}
