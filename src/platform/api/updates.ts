import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { isDesktopRuntime } from '../tauri'
import type { UpdateCheckResult, UpdateEvent } from '@/types'

/** 读取当前桌面应用版本 */
export function getCurrentVersion(): Promise<string> {
  if (isDesktopRuntime()) return getVersion()
  throw new Error('当前运行环境不支持此操作')
}

/** 检查 Tauri 更新清单 */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  if (isDesktopRuntime()) {
    await ensureEvents()
    return invoke('check_for_updates')
  }
  throw new Error('当前运行环境不支持此操作')
}

/** 下载并验证更新包 */
export function downloadUpdate(): Promise<void> {
  if (isDesktopRuntime()) return invoke('download_update')
  throw new Error('当前运行环境不支持此操作')
}

/** 安装已验证的更新包 */
export function installUpdate(): Promise<void> {
  if (isDesktopRuntime()) return invoke('install_update')
  throw new Error('当前运行环境不支持此操作')
}

/** 订阅各窗口共享的更新进度 */
export function onUpdateEvent(listener: (event: UpdateEvent) => void): () => void {
  if (isDesktopRuntime()) {
    subscribers.add(listener)
    if (latest) listener(latest)
    void ensureEvents().catch(console.error)
    return () => {
      subscribers.delete(listener)
    }
  }
  return () => {}
}

type VersionedEvent = UpdateEvent & { revision: number }
const subscribers = new Set<(event: UpdateEvent) => void>()
let latest: VersionedEvent | undefined
let ready: Promise<void> | undefined
let unlisten: UnlistenFn | undefined
let disposed = false

/** 按后端版本号应用状态，忽略迟到的旧快照 */
function deliver(event: VersionedEvent | null): void {
  if (!event || disposed || (latest && event.revision <= latest.revision)) return
  latest = event
  for (const listener of subscribers) listener(event)
}

/** 先订阅再读取状态，避免漏掉快速完成的更新任务 */
function ensureEvents(): Promise<void> {
  ready ??= listen<VersionedEvent>('app-update', ({ payload }) => deliver(payload))
    .then(async (release) => {
      if (disposed) {
        release()
        return
      }
      unlisten = release
      deliver(await invoke<VersionedEvent | null>('get_update_snapshot'))
    })
    .catch((error: unknown) => {
      unlisten?.()
      unlisten = undefined
      ready = undefined
      throw error
    })
  return ready
}

/** 在窗口卸载和热更新时释放更新事件订阅 */
function dispose(): void {
  disposed = true
  unlisten?.()
  subscribers.clear()
}
window.addEventListener('pagehide', dispose, { once: true })
if (import.meta.hot) import.meta.hot.dispose(dispose)
