import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { RecentPlayItem } from '@/types'
import { listRecentPlays, onAppDataChange, removeRecentPlay } from '@/platform/api'

interface UseRecentPlaysOptions {
  limit?: number
}

/** 加载并同步最近播放记录，丢弃过期的异步查询结果 */
export function useRecentPlays({ limit }: UseRecentPlaysOptions = {}): {
  recentPlays: RecentPlayItem[]
  isLoading: boolean
  deleteRecentPlay: (item: RecentPlayItem) => Promise<void>
} {
  const [recentPlays, setRecentPlays] = useState<RecentPlayItem[]>([])
  const [loaded, setLoaded] = useState<{ limit?: number }>()
  const refreshRef = useRef<(() => void) | undefined>(undefined)

  /** 加载最近播放列表并订阅应用数据变化 */
  useEffect(() => {
    let active = true
    let revision = 0
    /** 只发布当前查询的结果，避免旧请求覆盖最新数据 */
    const refresh = (): void => {
      const requestRevision = ++revision
      void listRecentPlays(limit)
        .then((items) => {
          if (active && requestRevision === revision) setRecentPlays(items)
        })
        .catch((error: unknown) => {
          if (active && requestRevision === revision) {
            console.error('加载最近播放失败', error)
            toast.error('加载最近播放失败')
          }
        })
        .finally(() => {
          if (active && requestRevision === revision) setLoaded({ limit })
        })
    }
    refreshRef.current = refresh
    const unsubscribe = onAppDataChange((domain) => {
      if (domain === 'app-data') refresh()
    })
    refresh()

    return () => {
      active = false
      refreshRef.current = undefined
      unsubscribe()
    }
  }, [limit])

  /** 删除后刷新当前范围，补齐有条数限制的列表并使旧查询失效 */
  const deleteRecentPlay = useCallback(async (item: RecentPlayItem): Promise<void> => {
    await removeRecentPlay(item.sourceId, item.vodId)
    if (refreshRef.current) {
      setRecentPlays((current) =>
        current.filter((recentItem) => recentItem.sourceId !== item.sourceId || recentItem.vodId !== item.vodId),
      )
      refreshRef.current()
    }
  }, [])

  return { recentPlays, isLoading: !loaded || loaded.limit !== limit, deleteRecentPlay }
}
