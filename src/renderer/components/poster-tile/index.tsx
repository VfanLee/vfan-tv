import { Badge } from '@/ui/badge'
import { MediaPoster } from '@renderer/components/media-poster'

interface PosterTileProps {
  baseUrl?: string
  title: string
  subtitle?: string
  poster?: string
  meta?: string
}

export function PosterTile({ baseUrl, title, subtitle, poster, meta }: PosterTileProps): React.JSX.Element {
  return (
    <article className="min-w-0">
      <MediaPoster baseUrl={baseUrl} className="aspect-[2/3]" poster={poster} showHoverScrim={false} title={title} />
      <h3 className="text-foreground mt-2 truncate text-sm font-medium">{title}</h3>
      {subtitle ? <p className="text-muted-foreground truncate text-xs">{subtitle}</p> : null}
      {meta ? <Badge className="mt-2 max-w-full truncate">{meta}</Badge> : null}
    </article>
  )
}
