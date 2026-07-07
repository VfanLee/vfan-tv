import { useState } from 'react'
import { Badge } from '@renderer/components/ui/badge'
import { resolveImageUrl } from '@shared/utils/media-image'

interface PosterTileProps {
  baseUrl?: string
  title: string
  subtitle?: string
  poster?: string
  meta?: string
}

export function PosterTile({ baseUrl, title, subtitle, poster, meta }: PosterTileProps): React.JSX.Element {
  const [failedPoster, setFailedPoster] = useState<string>()
  const imageSrc = poster && poster !== failedPoster ? resolveImageUrl(poster, { baseUrl }) : undefined

  return (
    <article className="min-w-0">
      <div className="border-border bg-muted aspect-[2/3] overflow-hidden rounded-xl border">
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
          <div className="text-muted-foreground flex size-full items-center justify-center px-3 text-center text-xs">
            暂无海报
          </div>
        )}
      </div>
      <h3 className="text-foreground mt-2 truncate text-sm font-medium">{title}</h3>
      {subtitle ? <p className="text-muted-foreground truncate text-xs">{subtitle}</p> : null}
      {meta ? <Badge className="mt-2 max-w-full truncate">{meta}</Badge> : null}
    </article>
  )
}
