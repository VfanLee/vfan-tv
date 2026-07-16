import { ChevronDown, Loader2, Play, Radio, RefreshCw, Search, Tv } from 'lucide-react'
import type { LiveChannel } from '@shared/types'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { cn } from '@/utils'
import type { useLivePlayer } from '../hooks/use-live-player'

type LivePlayerState = ReturnType<typeof useLivePlayer>

export function NowPlayingTitle({ title }: { title?: string }): React.JSX.Element {
  return (
    <div className="flex h-12 shrink-0 items-center pl-2 text-xl leading-6 font-semibold">
      <span className="truncate">正在播放：{title ?? '请选择频道'}</span>
    </div>
  )
}

export function LiveSidebar({ player }: { player: LivePlayerState }): React.JSX.Element {
  return (
    <aside className="flex min-h-[520px] flex-col gap-3 sm:gap-4 xl:min-h-0">
      <div className="border-border bg-card rounded-xl border px-3 py-3 sm:px-4 sm:py-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <Select
              disabled={player.isLoadingSettings || player.liveSources.length === 0 || player.isLoadingPlaylist}
              value={player.selectedSourceId || undefined}
              onValueChange={player.selectSource}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="暂无直播源" />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                <SelectGroup>
                  {player.liveSources.map((source) => (
                    <SelectItem key={source.id} value={source.id}>
                      {source.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <Button
            className="w-full sm:w-auto"
            disabled={!player.selectedSource || player.isLoadingPlaylist}
            onClick={() => void player.loadPlaylist({ force: true })}
          >
            {player.isLoadingPlaylist ? (
              <RefreshCw className="animate-spin" data-icon="inline-start" />
            ) : (
              <Radio data-icon="inline-start" />
            )}
            {player.isLoadingPlaylist ? '加载中' : '加载'}
          </Button>
        </div>
        <div className="text-muted-foreground mt-3 text-sm">
          {player.channelCount} 个频道 · {player.streamCount} 条线路
        </div>
      </div>

      <div className="border-border bg-card flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border">
        <div className="border-border border-b p-3 sm:p-4">
          <div className="border-input bg-background flex h-10 items-center gap-2 rounded-xl border px-3">
            <Search className="text-muted-foreground shrink-0" size={17} />
            <Input
              className="h-full border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              placeholder="搜索频道"
              value={player.keyword}
              onChange={(event) => player.setKeyword(event.target.value)}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {player.groupedChannels.length > 0 ? (
            <div className="flex flex-col p-3 sm:p-4">
              {player.groupedChannels.map((group) => (
                <section key={group.name} className="border-border border-b last:border-b-0">
                  <button
                    aria-expanded={player.expandedGroups.has(group.name)}
                    className="hover:bg-muted/70 focus-visible:ring-ring flex h-12 w-full items-center gap-2 rounded-lg px-2 text-left transition-colors outline-none focus-visible:ring-2"
                    type="button"
                    onClick={() => player.toggleGroup(group.name)}
                  >
                    <ChevronDown
                      className={cn(
                        'text-muted-foreground shrink-0 transition-transform',
                        player.expandedGroups.has(group.name) ? 'rotate-0' : '-rotate-90',
                      )}
                      size={16}
                    />
                    <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs font-semibold">
                      {group.name}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs font-semibold">
                      {group.channels.length}
                    </span>
                  </button>
                  {player.expandedGroups.has(group.name) ? (
                    <div className="flex flex-col gap-1.5 pb-3">
                      {group.channels.map((channel) => (
                        <ChannelButton
                          key={channel.id}
                          active={channel.id === player.activeChannelId}
                          channel={channel}
                          onClick={() => player.selectChannel(channel)}
                        />
                      ))}
                    </div>
                  ) : null}
                </section>
              ))}
            </div>
          ) : (
            <EmptyLiveState
              hasPlaylist={Boolean(player.playlist)}
              hasSources={player.liveSources.length > 0}
              isLoading={player.isLoadingPlaylist || player.isLoadingSettings}
            />
          )}
        </div>

        {player.activeChannel && player.activeChannel.streams.length > 1 ? (
          <div className="border-border bg-muted/40 border-t p-3 sm:p-4">
            <div className="mb-2 text-xs font-semibold">线路</div>
            <div className="flex flex-wrap gap-2">
              {player.activeChannel.streams.map((stream) => (
                <Button
                  key={stream.id}
                  size="sm"
                  variant={stream.id === player.activeStream?.id ? 'default' : 'outline'}
                  onClick={() => player.setActiveStreamId(stream.id)}
                >
                  {stream.name}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  )
}

function ChannelButton({
  active,
  channel,
  onClick,
}: {
  active: boolean
  channel: LiveChannel
  onClick: () => void
}): React.JSX.Element {
  const channelInitial = channel.title.trim().charAt(0).toUpperCase() || '台'
  return (
    <button
      className={cn(
        'focus-visible:ring-ring flex h-14 items-center gap-3 rounded-xl px-3 text-left transition-colors outline-none focus-visible:ring-2',
        active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-foreground',
      )}
      type="button"
      onClick={onClick}
    >
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-lg border text-sm font-bold',
          active
            ? 'border-primary-foreground/25 bg-primary-foreground/15 text-primary-foreground'
            : 'border-border bg-muted text-muted-foreground',
        )}
      >
        <span aria-hidden="true" className="leading-none">
          {channelInitial}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{channel.title}</span>
        <span className={cn('block truncate text-xs', active ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
          {channel.streams.length > 1 ? `${channel.streams.length} 条线路` : channel.group}
        </span>
      </span>
      <Play className="shrink-0" size={15} />
    </button>
  )
}

function EmptyLiveState({
  hasPlaylist,
  hasSources,
  isLoading,
}: {
  hasPlaylist: boolean
  hasSources: boolean
  isLoading: boolean
}): React.JSX.Element {
  const text = isLoading
    ? '正在加载'
    : !hasSources
      ? '请先在设置页添加直播源'
      : hasPlaylist
        ? '没有匹配的频道'
        : '选择直播源后点击加载'
  return (
    <div className="flex h-full min-h-[320px] items-center justify-center p-6 text-center">
      <div>
        {isLoading ? (
          <Loader2 className="text-muted-foreground mx-auto animate-spin" size={26} />
        ) : (
          <Tv className="text-muted-foreground mx-auto" size={28} />
        )}
        <div className="text-muted-foreground mt-3 text-sm font-semibold">{text}</div>
      </div>
    </div>
  )
}
