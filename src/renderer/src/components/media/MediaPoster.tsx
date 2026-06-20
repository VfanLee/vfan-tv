import { useState } from 'react'
import type { ReactNode } from 'react'
import { Play } from 'lucide-react'
import { resolveImageUrl } from '@shared/utils/media-image'

interface MediaPosterProps {
  baseUrl?: string
  className?: string
  headers?: Record<string, string>
  overlay?: ReactNode
  poster?: string
  title: string
}

export function MediaPoster({
  baseUrl,
  className,
  headers,
  overlay,
  poster,
  title,
}: MediaPosterProps): React.JSX.Element {
  const [failedPoster, setFailedPoster] = useState<string>()
  const imageSrc = poster && poster !== failedPoster ? resolveImageUrl(poster, { baseUrl, headers }) : undefined

  return (
    <div className={`border-border bg-muted relative overflow-hidden rounded-xl border shadow-sm ${className ?? ''}`}>
      {imageSrc ? (
        <img
          alt={title}
          className="size-full object-cover"
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
      {overlay ? <div className="absolute inset-0 flex items-center justify-center">{overlay}</div> : null}
    </div>
  )
}

export function PosterPlayOverlay(): React.JSX.Element {
  return (
    <div className="bg-background/80 text-foreground flex size-10 items-center justify-center rounded-full opacity-0 shadow-sm backdrop-blur transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
      <Play fill="currentColor" size={17} />
    </div>
  )
}
