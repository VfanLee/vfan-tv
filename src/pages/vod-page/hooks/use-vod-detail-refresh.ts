import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RecentVodDetailRefresh, VodSearchResult } from '@/types'
import { acknowledgeRecentUpdate, isApiAvailable, onAppDataChange, refreshRecentVodDetail } from '@/platform/api'

interface DetailState {
  visit: object
  attempt: number
  result?: RecentVodDetailRefresh
  newEpisodeKeys?: string[]
  error?: string
}

/** 直接刷新路由对应视频，保持较新的详情独立于同名搜索结果 */
export function useVodDetailRefresh(
  sourceId?: string,
  vodId?: string,
): {
  detail?: VodSearchResult
  updateRevision?: string
  newEpisodeKeys: string[]
  isRefreshing: boolean
  error?: string
  refresh: () => void
} {
  const key = JSON.stringify([sourceId, vodId])
  /** 每次进入不同视频建立独立访问身份，快速切回也不恢复已离开的标记 */
  const visit = useMemo(() => ({ key }), [key])
  const [state, setState] = useState<DetailState>()
  const [attempt, setAttempt] = useState(0)
  const revisionRef = useRef(0)
  const refresh = useCallback((): void => setAttempt((current) => current + 1), [])

  /** 页面进入、切换视频或重试时直接请求原源详情 */
  useEffect(() => {
    if (!sourceId || !vodId || !isApiAvailable()) return
    let active = true
    const revision = ++revisionRef.current
    void refreshRecentVodDetail(sourceId, vodId)
      .then((result) => {
        if (active && revision === revisionRef.current)
          setState((previous) => ({
            visit,
            attempt,
            result,
            // 提醒确认后仍保留本次页面访问的新集标记。
            newEpisodeKeys: Array.from(
              new Set([
                ...(previous?.visit === visit ? (previous.newEpisodeKeys ?? []) : []),
                ...(result.updateInfo?.newEpisodeKeys ?? []),
              ]),
            ),
          }))
      })
      .catch((error: unknown) => {
        if (active && revision === revisionRef.current)
          setState((previous) => ({
            visit,
            attempt,
            result: previous?.visit === visit ? previous.result : undefined,
            newEpisodeKeys: previous?.visit === visit ? previous.newEpisodeKeys : undefined,
            error: error instanceof Error ? error.message : String(error),
          }))
      })
    return () => {
      active = false
    }
  }, [attempt, sourceId, visit, vodId])

  /** 数据库或源配置变化时使旧请求失效，并重新读取详情 */
  useEffect(
    () =>
      onAppDataChange((domain) => {
        if (domain !== 'app-data' && domain !== 'vod-sources') return
        revisionRef.current += 1
        setState(undefined)
        refresh()
      }),
    [refresh],
  )

  const current = state?.visit === visit ? state : undefined
  const isRefreshing = Boolean(sourceId && vodId && isApiAvailable() && current?.attempt !== attempt)
  return {
    detail: current?.result?.detail,
    updateRevision: current?.result?.updateInfo?.revision,
    newEpisodeKeys: current?.newEpisodeKeys ?? [],
    isRefreshing,
    error: isRefreshing ? undefined : current?.error,
    refresh,
  }
}

/** 最新选集提交到可见面板后确认对应提醒版本 */
export function useAcknowledgeVodUpdate(
  sourceId: string | undefined,
  vodId: string | undefined,
  revision: string | undefined,
  visible: boolean,
): void {
  /** 仅确认实际展示的结果，卸载前尚未展示的结果不清除提醒 */
  useEffect(() => {
    if (!visible || !sourceId || !vodId || !revision) return
    void acknowledgeRecentUpdate(sourceId, vodId, revision).catch((error: unknown) =>
      console.error('确认剧集更新失败', error),
    )
  }, [revision, sourceId, visible, vodId])
}
