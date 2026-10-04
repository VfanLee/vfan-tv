import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  getVodEpisodeOrder,
  isApiAvailable,
  onAppDataChange,
  onVodEpisodeOrderChanged,
  setVodEpisodeOrder,
} from '@/platform/api'

interface OrderState {
  visit: object
  isDescending: boolean
  isSaving: boolean
}

interface OrderControl {
  visit: object
  toggle: () => Promise<void>
}

/** 同一视频的保存按操作顺序执行，切换页面后仍等待前一次保存 */
const pendingWrites = new Map<string, Promise<void>>()

/** 排队保存当前来源视频的排序，完成后释放队列项 */
function saveOrder(key: string, sourceId: string, vodId: string, isDescending: boolean): Promise<void> {
  const operation = (pendingWrites.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(() => setVodEpisodeOrder(sourceId, vodId, isDescending))
  pendingWrites.set(key, operation)
  void operation
    .finally(() => {
      if (pendingWrites.get(key) === operation) pendingWrites.delete(key)
    })
    .catch(() => {})
  return operation
}

/** 按来源和视频恢复、保存选集排序，并隔离已离开视频的异步结果 */
export function useVodEpisodeOrder(
  sourceId?: string,
  vodId?: string,
): { isDescending: boolean; isBusy: boolean; toggle: () => void } {
  const key = JSON.stringify([sourceId, vodId])
  /** 每次切换视频建立独立访问身份，避免快速切回时复用旧读取 */
  const visit = useMemo(() => ({ key }), [key])
  const [state, setState] = useState<OrderState>()
  const controlRef = useRef<OrderControl | undefined>(undefined)

  /** 读取当前视频的排序并订阅其他窗口及数据库恢复通知 */
  useEffect(() => {
    if (!sourceId || !vodId || !isApiAvailable()) return
    let active = true
    let revision = 0
    let order = false
    let ready = false
    let saving = false
    let reloadPending = false

    /** 等待该视频的保存完成后读取排序，仅接受当前访问的最新结果 */
    async function load(): Promise<void> {
      if (saving) {
        reloadPending = true
        return
      }
      const request = ++revision
      try {
        await pendingWrites.get(key)?.catch(() => {})
        if (!active || request !== revision) return
        const result = await getVodEpisodeOrder(sourceId!, vodId!)
        if (!active || request !== revision) return
        order = result
      } catch (error: unknown) {
        if (!active || request !== revision) return
        toast.error('读取选集排序失败', { description: String(error) })
      }
      ready = true
      setState({ visit, isDescending: order, isSaving: false })
    }

    /** 切换并保存当前视频的排序，失败时恢复原值 */
    async function toggleOrder(): Promise<void> {
      if (!active || !ready || saving) return
      revision += 1
      saving = true
      const previous = order
      order = !order
      setState({ visit, isDescending: order, isSaving: true })
      try {
        await saveOrder(key, sourceId!, vodId!, order)
      } catch (error: unknown) {
        order = previous
        toast.error('保存选集排序失败', { description: String(error) })
      } finally {
        saving = false
        if (active) {
          setState({ visit, isDescending: order, isSaving: false })
          if (reloadPending) {
            reloadPending = false
            void load()
          }
        }
      }
    }

    const control = { visit, toggle: toggleOrder }
    controlRef.current = control
    void load()
    const unlistenOrder = onVodEpisodeOrderChanged(() => void load())
    const unlistenData = onAppDataChange((domain) => {
      if (domain === 'app-data') void load()
    })
    return () => {
      active = false
      unlistenOrder()
      unlistenData()
      if (controlRef.current === control) controlRef.current = undefined
    }
  }, [key, sourceId, visit, vodId])

  /** 执行当前视频的切换，网页预览仅保存本次访问的内存状态 */
  const toggle = useCallback((): void => {
    if (!sourceId || !vodId) return
    if (controlRef.current?.visit === visit) void controlRef.current.toggle()
    else if (!isApiAvailable())
      setState((previous) => ({
        visit,
        isDescending: !(previous?.visit === visit && previous.isDescending),
        isSaving: false,
      }))
  }, [sourceId, visit, vodId])

  const current = state?.visit === visit ? state : undefined
  return {
    isDescending: current?.isDescending ?? false,
    isBusy: !sourceId || !vodId || Boolean(isApiAvailable() && !current) || Boolean(current?.isSaving),
    toggle,
  }
}
