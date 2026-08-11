import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, LoaderCircle, Radio } from 'lucide-react'
import { keyBy } from 'es-toolkit/array'
import type { RadioCategory, RadioChannel, RadioLiveProgram, RadioRegion } from '@shared/types'
import {
  getRadioBillboard,
  getRadioCategories,
  getRadioCategoryChannels,
  getRadioLivePrograms,
  getRadioRegions,
  searchRadioChannels,
} from '@renderer/platform/api'
import {
  EmptyState,
  RadioPlaybackControlIcon,
  RadioPlaybackEngine,
  RadioPlayerPanel,
  RadioStationCover,
} from '@/components'
import { useRadioPlayerStore } from '@/stores'
import { SearchBox, SegmentedTabs } from '@/ui'
import { cn } from '@/utils'

type RadioView = 'discover' | 'ranking'

/** 电台频道列表每页展示数量 */
const PAGE_SIZE = 30
/** 电台页面支持的视图标签 */
const RADIO_VIEW_TABS = [
  { value: 'discover', label: '发现电台' },
  { value: 'ranking', label: '排行榜' },
] as const

/** 渲染电台页面 */
export function RadioPage(): React.JSX.Element {
  const [view, setView] = useState<RadioView>('discover')
  const [categories, setCategories] = useState<RadioCategory[]>([])
  const [regions, setRegions] = useState<RadioRegion[]>([])
  const [categoryId, setCategoryId] = useState(0)
  const [regionId, setRegionId] = useState(0)
  const [keyword, setKeyword] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [channels, setChannels] = useState<RadioChannel[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const activeChannelId = useRadioPlayerStore((state) => state.channel?.id)
  const playbackStatus = useRadioPlayerStore((state) => state.status)
  const playChannel = useRadioPlayerStore((state) => state.playChannel)
  const resume = useRadioPlayerStore((state) => state.resume)

  /** 恢复电台播放器执行状态 */
  useEffect(() => {
    resume()
  }, [resume])

  /** 合并 IPTV 当前直播节目数据 */
  const mergeIptvPrograms = useCallback(async (items: RadioChannel[]): Promise<RadioChannel[]> => {
    if (!items.length) return items
    try {
      return applyLivePrograms(items, await getRadioLivePrograms(items.map((item) => item.id)))
    } catch {
      return items
    }
  }, [])

  /** 按当前视图、分类、地区和关键词加载电台频道 */
  const loadChannels = useCallback(
    async (
      nextView = view,
      nextCategoryId = categoryId,
      nextRegionId = regionId,
      nextKeyword = searchQuery,
    ): Promise<void> => {
      setIsLoading(true)
      setErrorMessage('')
      try {
        const normalizedKeyword = nextKeyword.trim()
        const items = normalizedKeyword
          ? (await searchRadioChannels(normalizedKeyword, 1, PAGE_SIZE)).items
          : nextView === 'ranking'
            ? await getRadioBillboard(nextCategoryId, nextRegionId)
            : await getRadioCategoryChannels(nextCategoryId, 1, PAGE_SIZE)
        setChannels(items)
        void mergeIptvPrograms(items).then((nextItems) => {
          setChannels((current) =>
            current.length === items.length && current.every((item, index) => item.id === items[index]?.id)
              ? nextItems
              : current,
          )
        })
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : '电台加载失败，请稍后重试。')
        setChannels([])
      } finally {
        setIsLoading(false)
      }
    },
    [categoryId, mergeIptvPrograms, regionId, searchQuery, view],
  )

  /** 加载电台分类、地区和默认频道 */
  useEffect(() => {
    let active = true
    /** 加载电台分类、地区和默认频道 */
    const initialize = async (): Promise<void> => {
      try {
        const [nextCategories, nextRegions] = await Promise.all([getRadioCategories(), getRadioRegions()])
        if (!active) return
        const initialCategoryId =
          nextCategories.find((category) => category.title === '音乐台')?.id ?? nextCategories[0]?.id ?? 0
        const initialRegionId = nextRegions[0]?.id ?? 0
        setCategories(nextCategories)
        setRegions(nextRegions)
        setCategoryId(initialCategoryId)
        setRegionId(initialRegionId)

        const items = await getRadioCategoryChannels(initialCategoryId, 1, PAGE_SIZE)
        if (!active) return
        setChannels(items)
        setIsLoading(false)
        if (!useRadioPlayerStore.getState().channel && items[0]) {
          useRadioPlayerStore.getState().playChannel(items[0])
        }
        void mergeIptvPrograms(items).then((nextItems) => {
          if (active) setChannels(nextItems)
        })
      } catch (error) {
        if (!active) return
        setErrorMessage(error instanceof Error ? error.message : '电台服务暂时不可用。')
        setIsLoading(false)
      }
    }
    void initialize()
    return () => {
      active = false
    }
  }, [mergeIptvPrograms])

  /** 定时刷新当前电台频道的直播节目 */
  useEffect(() => {
    if (!channels.length) return
    /** 重新加载当前电台频道的直播节目 */
    const refresh = (): void => {
      void getRadioLivePrograms(channels.map((item) => item.id))
        .then((programs) => setChannels((current) => applyLivePrograms(current, programs)))
        .catch(() => undefined)
    }
    const timer = window.setInterval(refresh, 45_000)
    return () => window.clearInterval(timer)
  }, [channels])

  const currentCategoryTitle = categories.find((item) => item.id === categoryId)?.title

  return (
    <div className="text-foreground min-h-full bg-transparent px-5 py-6 sm:px-8 sm:py-8">
      <RadioPlaybackEngine />
      <div className="w-full">
        <RadioPlayerPanel />

        <section className="mt-8" aria-live="polite">
          <div className="mb-5 flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-baseline gap-2">
                <h2 className="text-lg font-semibold tracking-tight">
                  {searchQuery
                    ? `“${searchQuery}” 的搜索结果`
                    : view === 'ranking'
                      ? '广播排行榜'
                      : (currentCategoryTitle ?? '推荐电台')}
                </h2>
                {!isLoading ? <span className="text-muted-foreground text-xs">{channels.length} 个电台</span> : null}
              </div>
              <SearchBox
                ariaLabel="搜索电台"
                className="sm:w-80"
                placeholder="搜索电台"
                value={keyword}
                onChange={setKeyword}
                onClear={() => {
                  setKeyword('')
                  setSearchQuery('')
                  void loadChannels(view, categoryId, regionId, '')
                }}
                onSubmit={() => {
                  const nextQuery = keyword.trim()
                  setSearchQuery(nextQuery)
                  void loadChannels(view, categoryId, regionId, nextQuery)
                }}
              />
            </div>

            {searchQuery ? null : (
              <>
                <SegmentedTabs
                  ariaLabel="电台浏览方式"
                  items={RADIO_VIEW_TABS}
                  value={view}
                  onValueChange={(nextView) => {
                    setView(nextView)
                    setKeyword('')
                    setSearchQuery('')
                    void loadChannels(nextView, categoryId, regionId, '')
                  }}
                />
                {view === 'discover' ? (
                  <SegmentedTabs
                    ariaLabel="电台分类"
                    className="max-w-full scrollbar-none overflow-x-auto"
                    items={categories.map((item) => ({ value: item.id, label: item.title }))}
                    value={categoryId}
                    onValueChange={(nextCategoryId) => {
                      setCategoryId(nextCategoryId)
                      void loadChannels(view, nextCategoryId, regionId, '')
                    }}
                  />
                ) : (
                  <div className="flex flex-wrap gap-3">
                    <FilterSelect
                      label="分类"
                      value={categoryId}
                      options={[{ id: 0, title: '全国总榜' }, ...categories]}
                      onChange={(value) => {
                        setCategoryId(value)
                        void loadChannels(view, value, regionId, '')
                      }}
                    />
                    <FilterSelect
                      label="地区"
                      value={regionId}
                      options={regions}
                      onChange={(value) => {
                        setRegionId(value)
                        void loadChannels('ranking', categoryId, value, '')
                      }}
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {isLoading ? (
            <div className="border-input bg-card flex h-56 items-center justify-center rounded-3xl border">
              <LoaderCircle className="text-primary animate-spin motion-reduce:animate-none" size={25} />
            </div>
          ) : errorMessage ? (
            <EmptyState
              action={{ label: '重试', onClick: () => void loadChannels() }}
              description={errorMessage}
              icon={AlertCircle}
              title="加载失败，可重试"
            />
          ) : channels.length ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {channels.map((channel, index) => {
                const selected = activeChannelId === channel.id
                return (
                  <ChannelCard
                    key={channel.id}
                    channel={channel}
                    playing={selected && playbackStatus === 'playing'}
                    rank={view === 'ranking' && !searchQuery ? index + 1 : undefined}
                    selected={selected}
                    onClick={() => playChannel(channel)}
                  />
                )
              })}
            </div>
          ) : (
            <EmptyState
              action={{ label: '重试', onClick: () => void loadChannels(), variant: 'outline' }}
              description="换个分类、地区或关键词再试试。"
              icon={Radio}
              title="没有找到匹配的电台"
            />
          )}
        </section>
      </div>
    </div>
  )
}

/** 渲染筛选选择器 */
function FilterSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string
  onChange: (value: number) => void
  options: RadioCategory[]
  value: number
}): React.JSX.Element {
  return (
    <label className="text-muted-foreground flex items-center gap-2 text-sm">
      {label}
      <select
        className="border-input bg-card text-foreground h-10 rounded-xl border px-3 text-sm outline-none"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {options.map((item) => (
          <option key={item.id} value={item.id}>
            {item.title}
          </option>
        ))}
      </select>
    </label>
  )
}

/** 渲染频道卡片 */
function ChannelCard({
  channel,
  onClick,
  playing,
  rank,
  selected,
}: {
  channel: RadioChannel
  onClick: () => void
  playing: boolean
  rank?: number
  selected: boolean
}): React.JSX.Element {
  return (
    <button
      aria-label={playing ? `${channel.title} 正在播放` : `播放 ${channel.title}`}
      className={cn(
        'border-input bg-card hover:border-primary/50 hover:bg-accent/30 group group/playback flex min-w-0 items-center gap-3 rounded-2xl border p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none',
        selected && 'border-primary bg-primary/5 ring-primary/10 ring-4',
      )}
      type="button"
      onClick={onClick}
    >
      {rank ? <span className="text-primary w-6 text-center font-mono text-sm font-bold">{rank}</span> : null}
      <RadioStationCover className="size-16 rounded-xl" channel={channel} />
      <span className="min-w-0 flex-1">
        <span className="text-foreground block truncate text-sm font-semibold">{channel.title}</span>
        <span className="text-muted-foreground mt-1.5 block truncate text-xs">
          {channel.nowPlayingTitle || '暂无节目单'}
        </span>
        <span className="text-muted-foreground/80 mt-1.5 block text-[10px]">
          {formatAudience(channel.audienceCount)}
        </span>
      </span>
      <RadioPlaybackControlIcon
        className={cn(
          selected
            ? 'scale-100 opacity-100'
            : 'scale-90 opacity-0 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100',
        )}
        state={playing ? 'playing' : 'play'}
      />
    </button>
  )
}

/** 将当前直播节目合并到电台频道数据 */
function applyLivePrograms(channels: RadioChannel[], programs: RadioLiveProgram[]): RadioChannel[] {
  const programsByChannelId = keyBy(programs, (program) => program.channelId)
  return channels.map((channel) => ({
    ...channel,
    nowPlayingTitle: programsByChannelId[channel.id]?.title || channel.nowPlayingTitle,
  }))
}

/** 格式化听众数 */
function formatAudience(value: number | undefined): string {
  if (!value) return '正在直播'
  return value >= 10_000 ? `${(value / 10_000).toFixed(1)} 万人收听` : `${value.toLocaleString()} 人收听`
}
