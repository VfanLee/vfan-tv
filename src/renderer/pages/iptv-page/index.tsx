import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ListFilter, MonitorPlay, RefreshCw, Search, Settings2, Tv2 } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { IPTV_SELECTED_SOURCE_STORAGE_KEY, IPTV_WALL_STATE_STORAGE_KEY } from '@shared/constants'
import type { IptvChannelPrograms, IptvPlaylist, IptvSourceConfig } from '@shared/types'
import { EmptyState } from '@renderer/components'
import {
  getIptvCatalog,
  getIptvPrograms,
  listIptvSources,
  onAppDataChange,
  openSettingsWindow,
} from '@renderer/platform/api'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { ChannelCard } from './components/channel-card'

/** 代表“全部频道分组”的筛选值 */
const ALL_GROUPS = '__all__'

/** 渲染 IPTV 频道浏览页面 */
export function IptvPage(): React.JSX.Element {
  const navigate = useNavigate()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [sources, setSources] = useState<IptvSourceConfig[]>([])
  const [sourceId, setSourceId] = useState(() => readWallState().sourceId)
  const [sourceConfigRevision, setSourceConfigRevision] = useState(0)
  const [playlist, setPlaylist] = useState<IptvPlaylist>()
  const [keyword, setKeyword] = useState(() => readWallState().keyword)
  const deferredKeyword = useDeferredValue(keyword.trim().toLowerCase())
  const [group, setGroup] = useState(() => readWallState().group)
  const [programs, setPrograms] = useState<Record<string, IptvChannelPrograms>>({})
  const [epgStatus, setEpgStatus] = useState<string>()
  const [previewRetryEpoch, setPreviewRetryEpoch] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [containerWidth, setContainerWidth] = useState(900)
  const restoredScrollRef = useRef(false)
  const source = sources.find((item) => item.id === sourceId)
  const groups = useMemo(() => [...new Set((playlist?.channels ?? []).map((channel) => channel.group))], [playlist])
  /** 根据频道分组和搜索词筛选后的频道列表 */
  const filteredChannels = useMemo(
    () =>
      (playlist?.channels ?? []).filter(
        (channel) =>
          (group === ALL_GROUPS || channel.group === group) &&
          (!deferredKeyword ||
            channel.title.toLowerCase().includes(deferredKeyword) ||
            channel.group.toLowerCase().includes(deferredKeyword)),
      ),
    [deferredKeyword, group, playlist],
  )
  const columns =
    containerWidth >= 1500 ? 5 : containerWidth >= 1160 ? 4 : containerWidth >= 820 ? 3 : containerWidth >= 520 ? 2 : 1
  const cardWidth = (containerWidth - (columns - 1) * 16) / columns
  const rowHeight = Math.max(252, Math.round((cardWidth * 9) / 16) + 116)
  const rowCount = Math.ceil(filteredChannels.length / columns)
  // TanStack Virtual 返回可变的虚拟滚动控制器。
  /** 频道墙长列表使用的虚拟滚动控制器 */
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 2,
  })
  const virtualRows = virtualizer.getVirtualItems()
  /** 当前虚拟滚动窗口中可见的频道 ID */
  const visibleChannelIds = virtualRows
    .flatMap((row) =>
      filteredChannels.slice(row.index * columns, row.index * columns + columns).map((channel) => channel.id),
    )
    .join(',')

  /** 加载可用 IPTV 源并订阅源数据变化 */
  useEffect(() => {
    let active = true
    /** 重新加载可用的 IPTV 源并重置频道状态 */
    const refreshSources = (invalidateCatalog = false): void => {
      void listIptvSources()
        .then((items) => {
          if (!active) return
          const available = items.filter((item) => !item.disabled)
          setSources(available)
          setSourceId((current) => (available.some((item) => item.id === current) ? current : (available[0]?.id ?? '')))
          setPrograms({})
          if (invalidateCatalog) setSourceConfigRevision((revision) => revision + 1)
        })
        .catch((error: unknown) => {
          if (active) toast.error('IPTV 源读取失败', { description: toErrorMessage(error) })
        })
        .finally(() => {
          if (active) setIsLoading(false)
        })
    }
    refreshSources()
    const unsubscribe = onAppDataChange((domain) => {
      if (domain === 'iptv-sources' || domain === 'app-data') refreshSources(true)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  /** 加载当前 IPTV 源的频道目录 */
  useEffect(() => {
    if (!sourceId) {
      setPlaylist(undefined)
      return
    }
    let active = true
    setIsLoading(true)
    void getIptvCatalog(sourceId)
      .then((catalog) => {
        if (active) setPlaylist(catalog)
      })
      .catch((error: unknown) => {
        if (active) toast.error('IPTV 源加载失败', { description: toErrorMessage(error) })
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [sourceConfigRevision, sourceId])

  /** 监听频道墙容器宽度并更新列数计算 */
  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width - 40))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  /** 频道目录加载后恢复频道墙滚动位置 */
  useEffect(() => {
    if (!playlist || restoredScrollRef.current) return
    restoredScrollRef.current = true
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: readWallState().scrollTop }))
  }, [playlist])

  /** 频道分组失效时切换到全部分组 */
  useEffect(() => {
    if (group !== ALL_GROUPS && playlist && !groups.includes(group)) setGroup(ALL_GROUPS)
  }, [group, groups, playlist])

  /** 加载当前可见频道的节目数据 */
  useEffect(() => {
    if (!sourceId || !visibleChannelIds) return
    let active = true
    const ids = visibleChannelIds.split(',')
    void getIptvPrograms(sourceId, ids).then((result) => {
      if (!active) return
      setPrograms((current) => ({
        ...current,
        ...Object.fromEntries(result.items.map((item) => [item.channelId, item])),
      }))
      setEpgStatus(
        result.errorMessage ? `${result.actualSource ?? 'EPG'}：${result.errorMessage}` : result.actualSource,
      )
    })
    return () => {
      active = false
    }
  }, [sourceId, visibleChannelIds])

  /** 保存频道墙筛选条件和滚动位置 */
  useEffect(() => {
    /** 保存频道墙的源、分组、关键词和滚动位置 */
    const save = (): void => writeWallState({ sourceId, group, keyword, scrollTop: scrollRef.current?.scrollTop ?? 0 })
    const element = scrollRef.current
    element?.addEventListener('scroll', save, { passive: true })
    save()
    return () => {
      element?.removeEventListener('scroll', save)
      save()
    }
  }, [group, keyword, sourceId])

  /** 刷新资源目录 */
  const refreshCatalog = async (): Promise<void> => {
    if (!sourceId) return
    setIsRefreshing(true)
    try {
      const catalog = await getIptvCatalog(sourceId, true)
      setPlaylist(catalog)
      setPrograms({})
      toast.success('频道列表已刷新', { description: `${catalog.channels.length} 个频道` })
    } catch (error) {
      toast.error('刷新失败', { description: toErrorMessage(error) })
    } finally {
      setIsRefreshing(false)
    }
  }

  /** 选择源 */
  const selectSource = (nextSourceId: string): void => {
    setSourceId(nextSourceId)
    setPlaylist(undefined)
    setPrograms({})
    setGroup(ALL_GROUPS)
    restoredScrollRef.current = true
    scrollRef.current?.scrollTo({ top: 0 })
    window.localStorage.setItem(IPTV_SELECTED_SOURCE_STORAGE_KEY, nextSourceId)
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="border-border bg-background/88 z-20 shrink-0 border-b px-5 py-4 backdrop-blur-xl sm:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto min-w-44">
            <h1 className="text-foreground text-2xl font-semibold tracking-tight">IPTV</h1>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {playlist ? `${playlist.channels.length} 个频道${playlist.cached ? ' · 已缓存' : ''}` : '频道墙'}
            </p>
          </div>
          <Select disabled={!sources.length || isLoading} value={sourceId} onValueChange={selectSource}>
            <SelectTrigger aria-label="选择 IPTV 源" className="w-48 shrink-0">
              <Tv2 className="text-muted-foreground size-4" />
              <SelectValue placeholder="选择 IPTV 源" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {sources.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select disabled={!playlist || isLoading} value={group} onValueChange={setGroup}>
            <SelectTrigger aria-label="选择频道分组" className="w-44 shrink-0">
              <ListFilter className="text-muted-foreground size-4" />
              <SelectValue placeholder="选择频道" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={ALL_GROUPS}>全部频道</SelectItem>
                {groups.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button disabled={!sourceId || isLoading} variant="outline">
                <RefreshCw className={isRefreshing ? 'animate-spin' : undefined} data-icon="inline-start" />
                刷新
                <ChevronDown className="text-muted-foreground size-4" data-icon="inline-end" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                className="bg-popover text-popover-foreground ring-foreground/10 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 z-50 min-w-44 rounded-lg p-1.5 shadow-md ring-1 outline-none"
                sideOffset={6}
              >
                <DropdownMenu.Item
                  className={REFRESH_MENU_ITEM_CLASS}
                  disabled={isRefreshing}
                  onSelect={() => void refreshCatalog()}
                >
                  <RefreshCw className={isRefreshing ? 'animate-spin' : undefined} />
                  刷新频道
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className={REFRESH_MENU_ITEM_CLASS}
                  disabled={isRefreshing}
                  onSelect={() => {
                    setPreviewRetryEpoch((value) => value + 1)
                    toast.success('正在刷新无预览频道')
                  }}
                >
                  <MonitorPlay />
                  刷新无预览频道
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <div className="relative order-last w-full sm:order-none sm:w-56 sm:shrink-0">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              className="pl-9"
              placeholder="搜索频道"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {epgStatus ? (
          <div className="text-muted-foreground px-5 pt-3 text-[11px] sm:px-8">节目单：{epgStatus}</div>
        ) : null}
        {filteredChannels.length && source ? (
          <div className="relative mx-5 my-4 sm:mx-8" style={{ height: virtualizer.getTotalSize() }}>
            {virtualRows.map((row) => (
              <div
                className="absolute top-0 left-0 grid w-full gap-4"
                key={row.key}
                style={{
                  height: rowHeight,
                  transform: `translateY(${row.start}px)`,
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                }}
              >
                {filteredChannels.slice(row.index * columns, row.index * columns + columns).map((channel) => (
                  <ChannelCard
                    key={channel.id}
                    channel={channel}
                    previewRetryEpoch={previewRetryEpoch}
                    programs={programs[channel.id]}
                    source={source}
                    onOpen={() => navigate(`/iptv/${source.id}/${channel.id}`)}
                  />
                ))}
              </div>
            ))}
          </div>
        ) : !isLoading ? (
          <div className="flex min-h-[480px] items-center justify-center p-8">
            <EmptyState
              action={
                !sources.length
                  ? {
                      icon: Settings2,
                      label: '添加 IPTV 源',
                      onClick: () => void openSettingsWindow('iptv'),
                    }
                  : undefined
              }
              description={!sources.length ? '先添加一个远程 M3U 或 TXT IPTV 源。' : '没有找到符合当前筛选的频道。'}
              icon={Tv2}
              title={!sources.length ? '还没有 IPTV 源' : '没有匹配频道'}
            />
          </div>
        ) : (
          <div className="text-muted-foreground flex min-h-[420px] items-center justify-center">
            <RefreshCw className="mr-2 size-5 animate-spin" />
            正在加载频道…
          </div>
        )}
      </div>
    </div>
  )
}

/** 频道墙刷新菜单项的共享样式 */
const REFRESH_MENU_ITEM_CLASS =
  'focus:bg-accent focus:text-accent-foreground data-[disabled]:text-muted-foreground flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4'

interface WallState {
  sourceId: string
  group: string
  keyword: string
  scrollTop: number
}
/** 读取频道墙状态 */
function readWallState(): WallState {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(IPTV_WALL_STATE_STORAGE_KEY) ?? '{}') as Partial<WallState>
    return {
      sourceId: parsed.sourceId ?? window.localStorage.getItem(IPTV_SELECTED_SOURCE_STORAGE_KEY) ?? '',
      group: parsed.group ?? ALL_GROUPS,
      keyword: parsed.keyword ?? '',
      scrollTop: parsed.scrollTop ?? 0,
    }
  } catch {
    return { sourceId: '', group: ALL_GROUPS, keyword: '', scrollTop: 0 }
  }
}
/** 保存频道墙状态 */
function writeWallState(value: WallState): void {
  try {
    window.sessionStorage.setItem(IPTV_WALL_STATE_STORAGE_KEY, JSON.stringify(value))
  } catch {
    /* 忽略频道墙状态保存失败 */
  }
}
/** 将未知错误转换为可展示的错误消息 */
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export { IptvPlayerPage } from './player-page'
