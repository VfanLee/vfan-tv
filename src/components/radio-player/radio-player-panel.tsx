import { useEffect, useState } from 'react'
import { Radio } from 'lucide-react'
import type { RadioChannel } from '@/types'
import { getRadioChannelDetail } from '@/platform/api'
import { useRadioPlayerStore } from '@/stores'
import { RadioBackground, RadioStationCover } from './radio-player-visuals'

/** 加载并展示当前电台详情 */
export function RadioPlayerPanel(): React.JSX.Element {
  const channel = useRadioPlayerStore((state) => state.channel)
  const [channelDetails, setChannelDetails] = useState<RadioChannel>()
  const channelId = channel?.id

  /** 加载当前电台频道详情 */
  useEffect(() => {
    if (!channelId) return

    let active = true
    void getRadioChannelDetail(channelId)
      .then((details) => {
        if (active) setChannelDetails(details)
      })
      .catch(() => undefined)

    return () => {
      active = false
    }
  }, [channelId])

  const currentChannelDetails = channelDetails?.id === channel?.id ? channelDetails : undefined
  const displayedChannel = channel
    ? {
        ...currentChannelDetails,
        ...channel,
        audienceCount: currentChannelDetails?.audienceCount ?? channel.audienceCount,
        category: currentChannelDetails?.category ?? channel.category,
        description: currentChannelDetails?.description ?? channel.description,
        region: currentChannelDetails?.region ?? channel.region,
      }
    : undefined

  return (
    <section
      className="border-input bg-background relative overflow-hidden rounded-[2rem] border shadow-sm"
      aria-label="当前电台信息"
    >
      <RadioBackground />
      <div aria-hidden="true" className="bg-background/5 dark:bg-background/10 pointer-events-none absolute inset-0" />
      <div className="relative p-5 sm:p-7 lg:p-9">
        <div className="grid items-center gap-6 md:grid-cols-[190px_minmax(0,1fr)] md:gap-8 lg:grid-cols-[240px_minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
          <div className="bg-card flex aspect-square items-center justify-center overflow-hidden rounded-[1.75rem] shadow-lg">
            {displayedChannel ? (
              <RadioStationCover className="size-full rounded-none" channel={displayedChannel} />
            ) : (
              <Radio className="text-primary size-14" strokeWidth={1.5} />
            )}
          </div>

          <div className="min-w-0 py-1 lg:py-5">
            <h2 className="truncate text-3xl font-semibold tracking-[-0.04em] sm:text-4xl lg:text-5xl">
              {displayedChannel?.title ?? '选择一个声音'}
            </h2>
            <p className="text-muted-foreground mt-4 min-h-7 truncate text-lg font-semibold sm:text-xl lg:text-2xl">
              {displayedChannel?.nowPlayingTitle ?? '选中后会立即开始播放'}
            </p>
          </div>

          <RadioStationDetails channel={displayedChannel} />
        </div>
      </div>
    </section>
  )
}

/** 显示电台节目、地区和受众信息 */
function RadioStationDetails({ channel }: { channel?: RadioChannel }): React.JSX.Element {
  const metadata = [
    { label: '分类', value: channel?.category?.title },
    { label: '地区', value: channel?.region?.title },
    { label: '收听', value: formatAudience(channel?.audienceCount) },
  ].filter((item): item is { label: string; value: string } => Boolean(item.value))

  return (
    <section className="border-border/60 min-w-0 md:col-span-2 lg:col-span-1 lg:border-l lg:py-5 lg:pl-10">
      <h3 className="text-muted-foreground text-xs font-medium tracking-[0.18em]">电台详情</h3>
      {channel ? (
        <>
          {metadata.length ? (
            <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
              {metadata.map((item) => (
                <div key={item.label} className="min-w-20">
                  <dt className="text-muted-foreground text-[11px]">{item.label}</dt>
                  <dd className="text-foreground mt-1 text-sm font-medium">{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <p className="text-muted-foreground mt-5 line-clamp-3 max-w-2xl text-sm leading-6">
            {channel.description || '该电台暂未提供详细介绍。'}
          </p>
        </>
      ) : (
        <p className="text-muted-foreground mt-4 text-sm leading-6">选择电台后，这里会显示分类、地区和简介。</p>
      )}
    </section>
  )
}

/** 将电台听众数转换为可读单位 */
function formatAudience(value: number | undefined): string | undefined {
  if (!value) return undefined
  return value >= 10_000 ? `${(value / 10_000).toFixed(1)} 万人` : `${value.toLocaleString()} 人`
}
