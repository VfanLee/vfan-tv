import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ListFilter, MonitorPlay, RefreshCw, Search, Settings2, Tv2 } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useUiPreferencesStore } from '@/stores'
import type { IptvChannel, IptvPlaylist } from '@/types'
import { BackToTop, EmptyState } from '@/components'
import { openSettingsWindow } from '@/platform/api'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { ChannelCard } from './components/channel-card'
import { clearIptvPreviewFailures } from './preview-cache'
import { useIptvCatalog, type CatalogStatus } from './use-iptv-catalog'

/** 代表“全部频道分组”的筛选值 */
const ALL_GROUPS = '__all__'

/** 渲染 IPTV 频道浏览页面 */
export function IptvPage(): React.JSX.Element {
  const navigate = useNavigate()
  const scrollRef = useRef<HTMLDivElement>(null)
  const {
    sources,
    sourceId,
    source,
    selectSource: selectCatalogSource,
    isLoadingSources,
    sourcesError,
    retrySources,
    playlist,
    isLoadingCatalog,
    catalogStatus,
    catalogError,
    retryCatalog,
    refreshCatalog: loadFreshCatalog,
  } = useIptvCatalog(readWallState().sourceId)
  const [keyword, setKeyword] = useState(() => readWallState().keyword)
  const deferredKeyword = useDeferredValue(keyword.trim().toLowerCase())
  const [group, setGroup] = useState(() => readWallState().group)
  const [previewRetryEpoch, setPreviewRetryEpoch] = useState(0)
  const [containerWidth, setContainerWidth] = useState(900)
  const restoredScrollRef = useRef(false)
  const isLoading = (isLoadingSources && !sources.length) || isLoadingCatalog
  const pageError = !sources.length ? sourcesError : !playlist ? catalogError : undefined
  const isCatalogBusy = catalogStatus === 'loading' || catalogStatus === 'refreshing'
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
  const rowHeight = Math.max(204, Math.round((cardWidth * 9) / 16) + 68)
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

  /** 统一处理更新与重试入口，主动更新完成后展示频道差异 */
  const runCatalogAction = async (action: 'refresh' | 'retry'): Promise<void> => {
    if (isCatalogBusy) return
    const result = await (action === 'refresh' ? loadFreshCatalog() : retryCatalog())
    if (!result || action === 'retry') return
    if (result.status === 'success') showCatalogRefreshResult(result.previous, result.catalog)
    else {
      toast.warning(result.hasPrevious ? '更新失败，保留已加载频道' : '频道加载失败', { description: result.error })
    }
  }

  /** 清除频道分组和搜索条件 */
  const clearFilters = (): void => {
    setGroup(ALL_GROUPS)
    setKeyword('')
    scrollRef.current?.scrollTo({ top: 0 })
  }

  /** 选择源 */
  const selectSource = (nextSourceId: string): void => {
    if (nextSourceId === sourceId) return
    selectCatalogSource(nextSourceId)
    setGroup(ALL_GROUPS)
    restoredScrollRef.current = true
    scrollRef.current?.scrollTo({ top: 0 })
    useUiPreferencesStore.getState().setIptvSourceId(nextSourceId)
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="border-border bg-background/88 z-20 shrink-0 border-b px-5 py-4 backdrop-blur-xl sm:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto min-w-44">
            <h1 className="text-foreground text-2xl font-semibold tracking-tight">IPTV</h1>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {playlist ? getCatalogSubtitle(playlist, catalogStatus) : '频道墙'}
            </p>
          </div>
          <Select disabled={!sources.length || isLoadingSources} value={sourceId} onValueChange={selectSource}>
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
          <Select disabled={!playlist} value={group} onValueChange={setGroup}>
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
              <Button disabled={!source || isLoadingSources} variant="outline">
                <RefreshCw
                  className={isCatalogBusy || isLoadingCatalog ? 'animate-spin' : undefined}
                  data-icon="inline-start"
                />
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
                  disabled={isCatalogBusy}
                  onSelect={() => void runCatalogAction('refresh')}
                >
                  <RefreshCw className={isCatalogBusy ? 'animate-spin' : undefined} />
                  从源更新频道
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className={REFRESH_MENU_ITEM_CLASS}
                  disabled={!playlist || isCatalogBusy}
                  onSelect={() => {
                    clearIptvPreviewFailures()
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

      {(sourcesError && sources.length > 0) || (catalogError && playlist) ? (
        <div role="alert" className="border-border flex items-center gap-3 border-b px-5 py-3 text-sm sm:px-8">
          <p className="min-w-0 flex-1">
            {sourcesError ? '源列表更新失败，保留已加载的源。' : '频道更新失败，保留已加载的频道。'}
            <span className="text-muted-foreground ml-1">{sourcesError ?? catalogError}</span>
          </p>
          <Button
            variant="outline"
            disabled={isLoadingSources || isCatalogBusy}
            onClick={() => (sourcesError ? retrySources() : void runCatalogAction('retry'))}
          >
            重试
          </Button>
        </div>
      ) : null}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
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
                pageError
                  ? {
                      icon: RefreshCw,
                      label: '重试',
                      onClick: () => (!sources.length ? retrySources() : void runCatalogAction('retry')),
                    }
                  : !sources.length
                    ? {
                        icon: Settings2,
                        label: '添加 IPTV 源',
                        onClick: () => void openSettingsWindow('iptv'),
                      }
                    : !playlist?.channels.length
                      ? {
                          icon: RefreshCw,
                          label: '从源更新频道',
                          onClick: () => void runCatalogAction('refresh'),
                        }
                      : { icon: ListFilter, label: '清除筛选', onClick: clearFilters }
              }
              description={
                pageError ??
                (!sources.length
                  ? '先添加一个远程 M3U 或 TXT IPTV 源。'
                  : !playlist?.channels.length
                    ? '该源未返回任何频道，可以从源更新后重试。'
                    : '没有找到符合当前筛选的频道。')
              }
              icon={Tv2}
              title={
                pageError
                  ? !sources.length
                    ? 'IPTV 源读取失败'
                    : '频道加载失败'
                  : !sources.length
                    ? '还没有 IPTV 源'
                    : !playlist?.channels.length
                      ? '源内暂无频道'
                      : '没有匹配频道'
              }
            />
          </div>
        ) : (
          <div className="text-muted-foreground flex min-h-[420px] items-center justify-center">
            <RefreshCw className="mr-2 size-5 animate-spin" />
            {isLoadingSources && !sources.length ? '正在加载 IPTV 源…' : '正在加载频道…'}
          </div>
        )}
      </div>
      <BackToTop scrollRef={scrollRef} />
    </div>
  )
}

/** 频道墙刷新菜单项的共享样式 */
const REFRESH_MENU_ITEM_CLASS =
  'focus:bg-accent focus:text-accent-foreground data-[disabled]:text-muted-foreground flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4'

const CATALOG_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

interface CatalogDiff {
  added: number
  removed: number
  changed: number
  reordered: boolean
}

/** 生成频道目录的缓存与刷新状态摘要 */
function getCatalogSubtitle(playlist: IptvPlaylist, status: CatalogStatus): string {
  const parts = [`${playlist.channels.length} 个频道`]
  if (status === 'refreshing') {
    parts.push('正在从源更新')
  } else if (status === 'error') {
    parts.push('更新失败，保留已加载频道')
  } else if (playlist.cached) {
    parts.push(playlist.stale ? '缓存已过期' : '缓存')
  } else {
    parts.push('源站')
  }
  parts.push(`上次成功拉取 ${CATALOG_TIME_FORMATTER.format(playlist.fetchedAt)}`)
  return parts.join(' · ')
}

/** 展示手动更新后的频道差异 */
function showCatalogRefreshResult(previous: IptvPlaylist | undefined, next: IptvPlaylist): void {
  if (!previous) {
    toast.success('频道列表已更新', { description: `共 ${next.channels.length} 个频道` })
    return
  }
  const diff = compareCatalogs(previous.channels, next.channels)
  if (diff.reordered) {
    toast.success('频道顺序已更新', { description: `共 ${next.channels.length} 个频道` })
    return
  }
  if (diff.added === 0 && diff.removed === 0 && diff.changed === 0) {
    toast.info('源站频道暂无变化', { description: `共 ${next.channels.length} 个频道` })
    return
  }
  const details = [
    diff.added ? `新增 ${diff.added}` : undefined,
    diff.removed ? `移除 ${diff.removed}` : undefined,
    diff.changed ? `内容变更 ${diff.changed}` : undefined,
    `共 ${next.channels.length} 个频道`,
  ].filter((value): value is string => Boolean(value))
  toast.success('频道列表已更新', { description: details.join(' · ') })
}

/** 比较频道增删、内容变化与纯顺序变化 */
function compareCatalogs(previous: IptvChannel[], next: IptvChannel[]): CatalogDiff {
  const previousById = new Map(previous.map((channel) => [channel.id, channel]))
  const nextIds = new Set(next.map((channel) => channel.id))
  let added = 0
  let changed = 0
  for (const channel of next) {
    const oldChannel = previousById.get(channel.id)
    if (!oldChannel) added += 1
    else if (!isSameChannel(oldChannel, channel)) changed += 1
  }
  const removed = previous.reduce((count, channel) => count + (nextIds.has(channel.id) ? 0 : 1), 0)
  const reordered =
    added === 0 && removed === 0 && changed === 0 && previous.some((channel, index) => channel.id !== next[index]?.id)
  return { added, removed, changed, reordered }
}

/** 判断同一频道的展示信息和播放线路是否一致 */
function isSameChannel(previous: IptvChannel, next: IptvChannel): boolean {
  return JSON.stringify(previous) === JSON.stringify(next)
}

interface WallState {
  sourceId: string
  group: string
  keyword: string
  scrollTop: number
}
/** 频道墙筛选和滚动位置只保留在当前窗口内 */
let wallState: WallState | undefined

/** 读取内存频道墙状态及已持久化的源选择 */
function readWallState(): WallState {
  return wallState
    ? { ...wallState }
    : { sourceId: useUiPreferencesStore.getState().iptvSourceId, group: ALL_GROUPS, keyword: '', scrollTop: 0 }
}

/** 保存频道墙临时状态，不写数据库 */
function writeWallState(value: WallState): void {
  wallState = { ...value }
}

export { IptvPlayerPage } from './player-page'
