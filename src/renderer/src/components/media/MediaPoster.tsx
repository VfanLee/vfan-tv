import { useState } from 'react'
import type { ReactNode } from 'react'
import { resolveImageUrl } from '@shared/utils/media-image'

interface MediaPosterProps {
  className?: string
  overlay?: ReactNode
  poster?: string
  title: string
}

export function MediaPoster({ className, overlay, poster, title }: MediaPosterProps): React.JSX.Element {
  const [failedPoster, setFailedPoster] = useState<string>()
  const imageSrc = poster && poster !== failedPoster ? resolveImageUrl(poster) : undefined

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
