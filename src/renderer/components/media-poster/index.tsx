import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Play } from 'lucide-react'
import type { MediaImageSourceType } from '@shared/types'
import { getSourceImageUrl } from '@renderer/platform/api'

interface MediaPosterProps {
  baseUrl?: string
  className?: string
  overlay?: ReactNode
  poster?: string
  sourceType?: MediaImageSourceType
  sourceId?: string
  showHoverScrim?: boolean
  title: string
}

export function MediaPoster({
  baseUrl,
  className,
  overlay,
  poster,
  sourceType = 'vod',
  sourceId,
  showHoverScrim = true,
  title,
}: MediaPosterProps): React.JSX.Element {
  const requestKey = `${sourceType}\u0000${sourceId ?? ''}\u0000${poster ?? ''}\u0000${baseUrl ?? ''}`
  const [resolvedImage, setResolvedImage] = useState<{ key: string; src: string }>()
  const [failedImage, setFailedImage] = useState<{ key: string; src: string }>()
  const imageSrc = resolvedImage?.key === requestKey ? resolvedImage.src : undefined
  const imageKey = requestKey
  const visibleSrc = imageSrc && !(failedImage?.key === imageKey && failedImage.src === imageSrc) ? imageSrc : undefined

  useEffect(() => {
    let active = true
    if (!poster) {
      return () => {
        active = false
      }
    }
    void getSourceImageUrl(sourceId, poster, baseUrl, sourceType)
      .then((url) => {
        if (active && url) setResolvedImage({ key: requestKey, src: url })
      })
      .catch(() => {
        if (active) setResolvedImage(undefined)
      })
    return () => {
      active = false
    }
  }, [baseUrl, poster, requestKey, sourceId, sourceType])

  return (
    <div className={`border-border bg-muted relative overflow-hidden rounded-xl border shadow-sm ${className ?? ''}`}>
      {visibleSrc ? (
        <img
          alt={title}
          className="size-full object-cover transition-transform duration-300 ease-out group-focus-within:scale-[1.04] group-hover:scale-[1.04] motion-reduce:transform-none motion-reduce:transition-none"
          loading="lazy"
          src={visibleSrc}
          onError={() => {
            setFailedImage({ key: imageKey, src: visibleSrc })
          }}
        />
      ) : (
        <div className="text-muted-foreground flex size-full items-center justify-center px-4 text-center text-sm font-medium">
          暂无海报
        </div>
      )}
      {visibleSrc && showHoverScrim ? (
        <div className="pointer-events-none absolute inset-0 bg-black opacity-0 transition-opacity duration-300 group-focus-within:opacity-20 group-hover:opacity-20 motion-reduce:transition-none" />
      ) : null}
      {overlay ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">{overlay}</div>
      ) : null}
    </div>
  )
}

export function PosterPlayOverlay(): React.JSX.Element {
  return (
    <div className="bg-background/80 text-foreground flex size-14 items-center justify-center rounded-full opacity-0 shadow-sm backdrop-blur transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
      <Play fill="currentColor" size={24} />
    </div>
  )
}
