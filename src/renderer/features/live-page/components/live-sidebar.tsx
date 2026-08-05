import { MonitorPlay, Play, Radio, RefreshCw, Search, Settings2 } from 'lucide-react'
import { useNavigate } from 'react-router'
import type { LiveChannel } from '@shared/types'
import { EmptyState } from '@renderer/components'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/ui/accordion'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { cn } from '@/utils'
import type { useLivePlayer } from '../hooks/use-live-player'

type LivePlayerState = ReturnType<typeof useLivePlayer>

export function LiveSidebar({ player }: { player: LivePlayerState }): React.JSX.Element {
  const isLoading = player.isLoadingPlaylist || player.isLoadingSettings

  return (
    <aside className="border-border bg-card flex min-h-[520px] flex-col overflow-hidden rounded-xl border xl:min-h-0">
      <div className="border-border shrink-0 border-b px-3 py-3 sm:px-4 sm:py-4">
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

      <div className="border-border shrink-0 border-b p-3 sm:p-4">
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
          <div className="p-3 sm:p-4">
            <Accordion
              collapsible
              type="single"
              value={[...player.expandedGroups][0] ?? ''}
              onValueChange={player.toggleGroup}
            >
              {player.groupedChannels.map((group) => (
                <AccordionItem key={group.name} value={group.name}>
                  <AccordionTrigger>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{group.name}</span>
                      <Badge variant="secondary">{group.channels.length} 个频道</Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="flex flex-col gap-1.5">
                      {group.channels.map((channel) => (
                        <ChannelButton
                          key={channel.id}
                          active={channel.id === player.activeChannelId}
                          channel={channel}
                          onClick={() => player.selectChannel(channel)}
                        />
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        ) : isLoading ? null : (
          <EmptyLiveState hasPlaylist={Boolean(player.playlist)} hasSources={player.liveSources.length > 0} />
        )}
      </div>

      {player.activeChannel && player.activeChannel.streams.length > 1 ? (
        <div className="border-border bg-muted/40 shrink-0 border-t p-3 sm:p-4">
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
  return (
    <button
      className={cn(
        'focus-visible:ring-ring flex h-11 items-center gap-3 rounded-xl px-3 text-left transition-colors outline-none focus-visible:ring-2',
        active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-foreground',
      )}
      type="button"
      onClick={onClick}
    >
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{channel.title}</span>
      <Play className="shrink-0" size={15} />
    </button>
  )
}

function EmptyLiveState({ hasPlaylist, hasSources }: { hasPlaylist: boolean; hasSources: boolean }): React.JSX.Element {
  const navigate = useNavigate()
  const title = !hasSources ? '还没有直播源' : hasPlaylist ? '没有匹配的频道' : '还没有加载频道'
  const description = !hasSources
    ? '请先在设置中添加直播源后再回来。'
    : hasPlaylist
      ? '换个关键词试试，或清除搜索条件。'
      : '选择直播源后点击加载。'

  return (
    <div className="flex h-full min-h-[320px] items-center justify-center p-4">
      <EmptyState
        action={!hasSources ? { icon: Settings2, label: '打开设置', onClick: () => navigate('/settings') } : undefined}
        density="compact"
        description={description}
        icon={MonitorPlay}
        title={title}
      />
    </div>
  )
}
