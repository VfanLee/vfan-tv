import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'

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

/** 一次读取界面使用的全部偏好域 */
export async function getUiPreferencesSnapshot(): Promise<Array<Preference & { scope: string }>> {
  return invoke('get_ui_preferences_snapshot')
}

interface PreferenceChange {
  scope: string
  origin: string
}

/** 将界面偏好持久化到 Rust 管理的 SQLite */
export async function setUiPreference(scope: string, key: string, value: JsonValue): Promise<void> {
  return invoke('set_ui_preference', { scope, key, value })
}

/** 订阅数据库偏好变化，调用方读取最新快照以同步多个窗口 */
export async function listenUiPreferences(listener: (scope?: string) => void): Promise<UnlistenFn> {
  const label = getCurrentWebviewWindow().label
  return listen<PreferenceChange | null | string>('ui-preferences-changed', ({ payload }) => {
    if (payload && typeof payload === 'object') {
      // 当前窗口在保存命令完成后读取，事件只负责其他窗口的同步
      if (payload.origin === label) return
      listener(payload.scope)
    } else {
      listener()
    }
  })
}

interface DesktopSubscription {
  listeners: Set<(payload: unknown) => void>
  unlisten?: UnlistenFn
}

/** 同一窗口内复用底层事件注册，最后一个订阅者退出时释放 */
const desktopSubscriptions = new Map<string, DesktopSubscription>()

/** 为 React 同步清理函数管理共享的异步 Tauri 事件订阅 */
export function subscribeDesktopEvent<T>(name: string, listener: (payload: T) => void): () => void {
  let subscription = desktopSubscriptions.get(name)
  if (!subscription) {
    const entry: DesktopSubscription = { listeners: new Set() }
    subscription = entry
    desktopSubscriptions.set(name, entry)
    void listen<unknown>(name, ({ payload }) => {
      for (const callback of entry.listeners) {
        try {
          callback(payload)
        } catch (error: unknown) {
          console.error(`处理 ${name} 失败`, error)
        }
      }
    })
      .then((release) => {
        if (entry.listeners.size === 0) release()
        else entry.unlisten = release
      })
      .catch((error: unknown) => {
        if (desktopSubscriptions.get(name) === entry) desktopSubscriptions.delete(name)
        console.error(`订阅 ${name} 失败`, error)
      })
  }
  const entry = subscription
  /** 将同名事件的负载交给调用方声明的业务类型 */
  const callback = (payload: unknown): void => listener(payload as T)
  entry.listeners.add(callback)
  return () => {
    if (!entry.listeners.delete(callback) || entry.listeners.size > 0) return
    if (desktopSubscriptions.get(name) === entry) desktopSubscriptions.delete(name)
    entry.unlisten?.()
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const entry of desktopSubscriptions.values()) {
      entry.listeners.clear()
      entry.unlisten?.()
    }
    desktopSubscriptions.clear()
  })
}
