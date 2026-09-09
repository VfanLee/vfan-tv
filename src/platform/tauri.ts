import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export { isTauri as isDesktopRuntime } from '@tauri-apps/api/core'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

interface RuntimeInfo {
  version: string
  databasePath: string
}

interface Preference {
  key: string
  value: JsonValue
}

/** 读取 Tauri 运行时信息，普通浏览器环境返回 undefined */
export async function getTauriRuntimeInfo(): Promise<RuntimeInfo | undefined> {
  return isTauri() ? invoke<RuntimeInfo>('get_runtime_info') : undefined
}

/** 从 Rust 数据库读取指定域的界面偏好 */
export async function listUiPreferences(scope: string): Promise<Preference[]> {
  return invoke<Preference[]>('list_ui_preferences', { scope })
}

/** 将界面偏好持久化到 Rust 管理的 SQLite */
export async function setUiPreference(scope: string, key: string, value: JsonValue): Promise<void> {
  return invoke('set_ui_preference', { scope, key, value })
}

/** 订阅数据库偏好变化，调用方读取最新快照以同步多个窗口 */
export async function listenUiPreferences(listener: () => void): Promise<UnlistenFn> {
  return listen('ui-preferences-changed', listener)
}

/** 为 React 同步清理函数管理异步注册的 Tauri 事件 */
export function subscribeDesktopEvent<T>(name: string, listener: (payload: T) => void): () => void {
  let disposed = false
  let unlisten: UnlistenFn | undefined
  void listen<T>(name, (event) => {
    if (!disposed) listener(event.payload)
  })
    .then((release) => {
      if (disposed) release()
      else unlisten = release
    })
    .catch((error: unknown) => console.error(`订阅 ${name} 失败`, error))
  return () => {
    disposed = true
    unlisten?.()
  }
}
