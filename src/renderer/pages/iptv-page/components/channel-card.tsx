import { useEffect, useRef, useState } from 'react'
import { Play } from 'lucide-react'
import type { IptvChannel, IptvSourceConfig } from '@shared/types'
import { getIptvPlaybackTarget, releaseMediaPlaybackSession } from '@renderer/platform/api'
import { getLivePreview } from '../preview-cache'
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
  const requestKey = `${source.id}:${channel.id}:${channel.streams[0]?.id ?? ''}`
  const successfulPreviewKeyRef = useRef('')
  const [previewState, setPreviewState] = useState<{ key: string; image?: string; failed?: boolean }>({ key: '' })
  const preview = previewState.key === requestKey ? previewState.image : undefined

  /** 解析频道播放地址并截取预览画面 */
  useEffect(() => {
    const stream = channel.streams[0]
    if (!stream || successfulPreviewKeyRef.current === requestKey) return
    const controller = new AbortController()
    void getLivePreview(
      requestKey,
      async () => {
        const target = await getIptvPlaybackTarget(source.id, channel.id, stream.id)
        return {
          src: target.src,
          type: target.streamType,
          release: () => releaseMediaPlaybackSession(target.mediaSessionId),
        }
      },
      controller.signal,
    )
      .then((image) => {
        successfulPreviewKeyRef.current = requestKey
        setPreviewState({ key: requestKey, image })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return
        setPreviewState({ key: requestKey, failed: true })
      })
    return () => controller.abort()
  }, [channel.id, channel.streams, previewRetryEpoch, requestKey, source.id])

  return (
    <button
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
