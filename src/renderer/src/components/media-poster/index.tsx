import { useState } from 'react'
import type { ReactNode } from 'react'
import { Play } from 'lucide-react'
import { resolveImageUrl } from '@shared/utils/media-image'

interface MediaPosterProps {
  baseUrl?: string
  className?: string
  overlay?: ReactNode
  poster?: string
  showHoverScrim?: boolean
  title: string
}

export function MediaPoster({
  baseUrl,
  className,
  overlay,
  poster,
  showHoverScrim = true,
  title,
}: MediaPosterProps): React.JSX.Element {
  const [failedPoster, setFailedPoster] = useState<string>()
  const imageSrc = poster && poster !== failedPoster ? resolveImageUrl(poster, { baseUrl }) : undefined

  return (
    <div className={`border-border bg-muted relative overflow-hidden rounded-xl border shadow-sm ${className ?? ''}`}>
      {imageSrc ? (
        <img
          alt={title}
          className="size-full object-cover transition-transform duration-300 ease-out group-focus-within:scale-[1.04] group-hover:scale-[1.04] motion-reduce:transform-none motion-reduce:transition-none"
          loading="lazy"
          src={imageSrc}
          onError={() => {
            if (poster) {
              setFailedPoster(poster)
            }
          }}
        />
      ) : (
        <div className="text-muted-foreground flex size-full items-center justify-center px-4 text-center text-sm font-medium">
          暂无海报
        </div>
      )}
      {imageSrc && showHoverScrim ? (
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
