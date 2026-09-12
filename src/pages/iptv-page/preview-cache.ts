import type { MediaStreamType } from '@/types'
import { capturePreviewFrame } from './preview-frame'

/** 成功封面与失败记录各自最多保留的条目数 */
const MAX_PREVIEWS = 120
/** 预览任务的最大并发数，为正式播放保留媒体探测资源 */
const MAX_CONCURRENT = 2
/** 失败频道再次自动尝试前的冷却时间 */
const FAILURE_COOLDOWN_MS = 30_000
/** 按频道及线路配置缓存已生成的封面 */
const cache = new Map<string, string>()
/** 尚在冷却中的失败预览 */
const failures = new Map<string, { error: unknown; retryAt: number }>()
/** 同一频道的多个可见卡片共用一个预览任务 */
const pending = new Map<string, PreviewTask>()
/** 等待预览执行槽位的可取消任务队列 */
const waiters: Array<() => void> = []
/** 包含播放地址解析和会话释放的实际执行任务数 */
let activeCount = 0

interface PreviewTask {
  controller: AbortController
  promise: Promise<string>
  consumers: number
  settled: boolean
}

interface LivePreviewTarget {
  src: string
  type: MediaStreamType
  release?: () => Promise<void> | void
}

/** 清除预览缓存并取消旧任务，避免旧结果重新写入缓存 */
export function clearIptvPreviewCache(): void {
  cache.clear()
  failures.clear()
  for (const task of pending.values()) task.controller.abort()
  pending.clear()
}

/** 手动刷新无预览频道时允许重新尝试失败线路 */
export function clearIptvPreviewFailures(): void {
  for (const key of failures.keys()) pending.get(key)?.controller.abort()
  failures.clear()
}

/** 读取成功封面并更新最近使用顺序，不发起预览请求 */
export function readCachedLivePreview(key: string): string | undefined {
  const image = cache.get(key)
  if (image) {
    cache.delete(key)
    cache.set(key, image)
  }
  return image
}

/** 复用成功封面或进行中的预览，为每个调用方独立处理取消 */
export async function getLivePreview(
  key: string,
  resolveTarget: () => Promise<LivePreviewTarget>,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted()
  const cached = readCachedLivePreview(key)
  if (cached) return cached
  const failure = failures.get(key)
  if (failure && failure.retryAt > Date.now()) throw failure.error
  failures.delete(key)

  let task = pending.get(key)
  if (!task || task.controller.signal.aborted) {
    const controller = new AbortController()
    const created: PreviewTask = {
      controller,
      consumers: 0,
      settled: false,
      promise: runPreview(key, resolveTarget, controller.signal).finally(() => {
        created.settled = true
        if (pending.get(key) === created) pending.delete(key)
      }),
    }
    pending.set(key, created)
    task = created
  }
  return subscribePreview(task, signal)
}

/** 最后一个调用方离开后取消共享任务，避免影响仍然可见的其他卡片 */
function subscribePreview(task: PreviewTask, signal: AbortSignal): Promise<string> {
  task.consumers += 1
  return new Promise((resolve, reject) => {
    let settled = false
    /** 解除单个调用方的订阅并按需取消共享任务 */
    const detach = (): void => {
      settled = true
      signal.removeEventListener('abort', abort)
      task.consumers -= 1
      if (!task.consumers && !task.settled) task.controller.abort()
    }
    /** 立即结束已离开可视区域的调用方 */
    const abort = (): void => {
      if (settled) return
      detach()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
    task.promise.then(
      (image) => {
        if (settled) return
        detach()
        resolve(image)
      },
      (error: unknown) => {
        if (settled) return
        detach()
        reject(error)
      },
    )
    if (signal.aborted) abort()
  })
}

/** 获取播放地址并抓取首帧，在所有阶段维持并发上限和资源释放 */
async function runPreview(
  key: string,
  resolveTarget: () => Promise<LivePreviewTarget>,
  signal: AbortSignal,
): Promise<string> {
  await acquire(signal)
  let target: LivePreviewTarget | undefined
  try {
    signal.throwIfAborted()
    target = await resolveTarget()
    signal.throwIfAborted()
    const image = await capturePreviewFrame(target.src, target.type, signal)
    signal.throwIfAborted()
    cache.set(key, image)
    while (cache.size > MAX_PREVIEWS) cache.delete(cache.keys().next().value as string)
    return image
  } catch (error) {
    if (!signal.aborted) {
      failures.set(key, { error, retryAt: Date.now() + FAILURE_COOLDOWN_MS })
      while (failures.size > MAX_PREVIEWS) failures.delete(failures.keys().next().value as string)
    }
    throw error
  } finally {
    try {
      await target?.release?.()
    } catch {
      /* 忽略预览媒体会话释放失败 */
    }
    release()
  }
}

/** 获取一个预览执行槽位，排队期间离开的任务立即移除 */
async function acquire(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  if (activeCount < MAX_CONCURRENT) {
    activeCount += 1
    return
  }
  await new Promise<void>((resolve, reject) => {
    /** 为下一个等待任务分配预览执行槽位 */
    const grant = (): void => {
      signal.removeEventListener('abort', abort)
      activeCount += 1
      resolve()
    }
    /** 取消等待中的预览任务 */
    const abort = (): void => {
      const index = waiters.indexOf(grant)
      if (index >= 0) waiters.splice(index, 1)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    waiters.push(grant)
    signal.addEventListener('abort', abort, { once: true })
  })
}

/** 在实际任务退出后释放槽位，继续处理当前可见频道 */
function release(): void {
  activeCount = Math.max(0, activeCount - 1)
  waiters.shift()?.()
}
