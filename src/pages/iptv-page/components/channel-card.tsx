import { useEffect, useRef, useState } from 'react'
import { Play } from 'lucide-react'
import type { IptvChannel, IptvSourceConfig } from '@/types'
import { getIptvPlaybackTarget, releaseMediaPlaybackSession } from '@/platform/api'
import { getLivePreview, readCachedLivePreview } from '../preview-cache'
import { observePreviewVisibility } from '../preview-visibility'
import { IptvChannelLogo } from './iptv-channel-logo'

/** 渲染频道卡片 */
export function ChannelCard({
  channel,
  previewRetryEpoch,
  source,
  onOpen,
}: {
  channel: IptvChannel
  previewRetryEpoch: number
  source: IptvSourceConfig
  onOpen: () => void
}): React.JSX.Element {
  const cardRef = useRef<HTMLButtonElement>(null)
  const stream = channel.streams[0]
  const streamId = stream?.id
  /** 封面按源配置和首条线路配置复用，避免请求头变更后复用旧画面 */
  const requestKey = JSON.stringify([
    source.id,
    source.url,
    source.headers,
    channel.id,
    streamId,
    stream?.url,
    stream?.requestHeaders,
  ])
  const [previewState, setPreviewState] = useState<{ key: string; image?: string }>(() => ({
    key: requestKey,
    image: readCachedLivePreview(requestKey),
  }))
  const preview = previewState.key === requestKey ? previewState.image : readCachedLivePreview(requestKey)

  /** 复用已有封面，仅为持续可见的卡片解析播放地址和抓帧 */
  useEffect(() => {
    const element = cardRef.current
    if (!element || !streamId || preview) return
    let controller: AbortController | undefined
    const stopObserving = observePreviewVisibility(element, (visible) => {
      controller?.abort()
      controller = undefined
      if (!visible) return
      const request = new AbortController()
      controller = request
      void getLivePreview(
        requestKey,
        async () => {
          const target = await getIptvPlaybackTarget(source.id, channel.id, streamId)
          return {
            src: target.src,
            type: target.streamType,
            release: () => releaseMediaPlaybackSession(target.mediaSessionId),
          }
        },
        request.signal,
      )
        .then((image) => {
          if (request.signal.aborted) return
          setPreviewState({ key: requestKey, image })
        })
        .catch(() => {
          /* 失败保留频道图标，冷却或手动刷新后再尝试 */
        })
    })
    return () => {
      stopObserving()
      controller?.abort()
    }
  }, [channel.id, streamId, preview, previewRetryEpoch, requestKey, source.id])

  return (
    <button
      ref={cardRef}
      aria-label={`播放 ${channel.title}`}
      className="group focus-visible:ring-ring bg-card border-border block w-full overflow-hidden rounded-xl border text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:outline-none motion-reduce:hover:translate-y-0"
      type="button"
      onClick={onOpen}
    >
      <div className="bg-muted relative aspect-video overflow-hidden">
        {preview ? (
          <img
            alt=""
            className="size-full object-cover transition duration-300 group-hover:scale-[1.02]"
            decoding="async"
            loading="lazy"
            src={preview}
          />
        ) : (
          <div className="from-muted to-accent/60 flex size-full items-center justify-center bg-linear-to-br">
            <IptvChannelLogo
              className="h-16 w-28 bg-transparent"
              iconClassName="size-8"
              imageClassName="opacity-90"
              sourceId={source.id}
              src={channel.logo}
            />
          </div>
        )}
        <span className="bg-background/85 text-foreground absolute top-2 left-2 rounded-md px-2 py-1 text-[11px] font-medium backdrop-blur">
          {channel.group}
        </span>
        <span className="bg-primary text-primary-foreground absolute right-2 bottom-2 flex size-8 items-center justify-center rounded-full opacity-0 shadow-md transition group-hover:opacity-100">
          <Play className="ml-0.5 size-4 fill-current" />
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-2.5 p-3">
        <IptvChannelLogo className="size-7 rounded-md" imageClassName="p-0.5" sourceId={source.id} src={channel.logo} />
        <h3 className="text-foreground truncate text-sm font-semibold">{channel.title}</h3>
        {channel.streams.length > 1 ? (
          <span className="bg-muted text-muted-foreground ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px]">
            {channel.streams.length} 线
          </span>
        ) : null}
      </div>
    </button>
  )
}
