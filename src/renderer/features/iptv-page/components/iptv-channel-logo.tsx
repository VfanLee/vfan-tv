import { useEffect, useState } from 'react'
import { Tv } from 'lucide-react'
import { getSourceImageUrl } from '@renderer/platform/api'
import { cn } from '@/utils'

interface IptvChannelLogoProps {
  sourceId?: string
  src?: string
  className?: string
  imageClassName?: string
  iconClassName?: string
}

export function IptvChannelLogo({
  src,
  sourceId,
  className,
  imageClassName,
  iconClassName,
}: IptvChannelLogoProps): React.JSX.Element {
  const [failedSrc, setFailedSrc] = useState<string>()
  const [resolvedImage, setResolvedImage] = useState<{ key: string; url?: string }>()
  const resolvedSrc = resolvedImage && resolvedImage.key === src ? resolvedImage.url : undefined
  const showImage = Boolean(resolvedSrc && failedSrc !== resolvedSrc)

  useEffect(() => {
    let active = true
    if (src) {
      void getSourceImageUrl(sourceId, src, undefined, 'iptv').then((value) => {
        if (active) setResolvedImage({ key: src, url: value })
      })
    }
    return () => {
      active = false
    }
  }, [sourceId, src])

  return (
    <span
      aria-hidden="true"
      className={cn(
        'bg-muted text-muted-foreground relative flex shrink-0 items-center justify-center overflow-hidden',
        className,
      )}
    >
      {showImage ? (
        <img
          alt=""
          className={cn('size-full object-contain', imageClassName)}
          src={resolvedSrc}
          onError={() => setFailedSrc(resolvedSrc)}
        />
      ) : (
        <Tv className={cn('size-5', iconClassName)} />
      )}
    </span>
  )
}
