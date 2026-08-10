import { useCallback, useEffect, useState } from 'react'
import type { RecentPlayItem } from '@shared/types'
import { listRecentPlays, onAppDataChange, removeRecentPlay } from '@renderer/platform/api'

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
    const refresh = (): void => {
      void listRecentPlays(limit)
        .then((items) => {
          if (active) setRecentPlays(items)
        })
        .finally(() => {
          if (active) setIsLoading(false)
        })
    }
    refresh()
    const unsubscribe = onAppDataChange((domain) => {
      if (domain === 'app-data') refresh()
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [limit])

  const deleteRecentPlay = useCallback(async (item: RecentPlayItem): Promise<void> => {
    await removeRecentPlay(item.title)
    setRecentPlays((current) => current.filter((recentItem) => recentItem.title !== item.title))
  }, [])

  return { recentPlays, isLoading, deleteRecentPlay }
}
