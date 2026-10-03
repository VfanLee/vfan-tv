import { useCallback, useEffect, useRef, useState } from 'react'
import { checkRecentUpdates, isApiAvailable, onAppDataChange } from '@/platform/api'

/** 组合原源和视频标识，避免不同作品相互覆盖检查状态 */
export function getRecentUpdateKey(sourceId: string, vodId: string): string {
  return JSON.stringify([sourceId, vodId])
}

/** 页面进入时检查最近记录，并丢弃卸载或导入之前的检查结果 */
export function useRecentUpdates(limit?: number): {
  isChecking: boolean
  errors: Record<string, string>
  checkError?: string
  check: (force?: boolean) => Promise<void>
} {
  const [isChecking, setIsChecking] = useState(isApiAvailable())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [checkError, setCheckError] = useState<string>()
  const revisionRef = useRef(0)
  const pendingRef = useRef(false)

  /** 检查最近列表并展示每个失败条目的原因 */
  const check = useCallback(
    async (force = false): Promise<void> => {
      if (!isApiAvailable() || pendingRef.current) return
      const revision = ++revisionRef.current
      pendingRef.current = true
      setIsChecking(true)
      setErrors({})
      setCheckError(undefined)
      try {
        const results = await checkRecentUpdates(force, limit)
        if (revision !== revisionRef.current) return
        setErrors(
          Object.fromEntries(
            results
              .filter((item) => item.error)
              .map((item) => [getRecentUpdateKey(item.sourceId, item.vodId), item.error as string]),
          ),
        )
      } catch (error) {
        if (revision === revisionRef.current) setCheckError(error instanceof Error ? error.message : String(error))
      } finally {
        if (revision === revisionRef.current) {
          pendingRef.current = false
          setIsChecking(false)
        }
      }
    },
    [limit],
  )

  /** 初次进入页面及数据库恢复后检查最近列表 */
  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => {
      if (active) void check()
    })
    const unsubscribe = onAppDataChange((domain) => {
      if (domain !== 'app-data' && domain !== 'vod-sources') return
      revisionRef.current += 1
      pendingRef.current = false
      void check()
    })
    return () => {
      active = false
      revisionRef.current += 1
      pendingRef.current = false
      unsubscribe()
    }
  }, [check])

  return { isChecking, errors, checkError, check }
}
