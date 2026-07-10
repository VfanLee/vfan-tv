import { useCallback, useEffect, useState } from 'react'
import type { RecentPlayItem } from '@shared/types'
import { listRecentPlays, removeRecentPlay } from '@renderer/services/api'

interface UseRecentPlaysOptions {
  limit?: number
}

export function useRecentPlays({ limit }: UseRecentPlaysOptions = {}): {
  recentPlays: RecentPlayItem[]
  isLoading: boolean
  deleteRecentPlay: (item: RecentPlayItem) => Promise<void>
} {
  const [recentPlays, setRecentPlays] = useState<RecentPlayItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true

    void listRecentPlays(limit)
      .then((items) => {
        if (active) {
          setRecentPlays(items)
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [limit])

  const deleteRecentPlay = useCallback(async (item: RecentPlayItem): Promise<void> => {
    await removeRecentPlay(item.title)
    setRecentPlays((current) => current.filter((recentItem) => recentItem.title !== item.title))
  }, [])

  return { recentPlays, isLoading, deleteRecentPlay }
}
