import { Skeleton } from '@/ui/skeleton'

export function PosterCardSkeleton(): React.JSX.Element {
  return (
    <div aria-hidden="true" className="min-w-0">
      <Skeleton className="aspect-[2/3] w-full rounded-xl" />
      <Skeleton className="mt-3 h-4 w-3/4" />
      <Skeleton className="mt-2 h-3 w-1/2" />
    </div>
  )
}
