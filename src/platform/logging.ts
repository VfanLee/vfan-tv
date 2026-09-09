import * as logger from '@tauri-apps/plugin-log'
import { isDesktopRuntime } from './tauri'

/** 限制单条日志大小并兼容异常、循环引用和不可序列化对象 */
function serialize(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ''}`.slice(0, 16384)
  if (typeof value === 'string') return value.slice(0, 16384)
  try {
    const seen = new WeakSet<object>()
    return (
      JSON.stringify(value, (_key, item: unknown) => {
        if (typeof item === 'bigint') return String(item)
        if (item && typeof item === 'object') {
          if (seen.has(item)) return '[Circular]'
          seen.add(item)
        }
        return item
      }) ?? String(value)
    ).slice(0, 16384)
  } catch {
    return '[无法序列化的日志内容]'
  }
}

/** 转发控制台和未处理异常；清理时恢复原函数，避免热更新重复转发 */
export function initializeLogging(): () => void {
  if (!isDesktopRuntime()) return () => {}
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  }
  const writers = { log: logger.info, info: logger.info, warn: logger.warn, error: logger.error, debug: logger.debug }
  let disposed = false
  let pending = 0
  /** 限制未完成的日志请求，避免播放器异常循环堆积 IPC */
  const forward = (level: keyof typeof writers, args: unknown[]): void => {
    if (disposed || pending >= 100) return
    pending += 1
    void writers[level](args.map(serialize).join(' ').slice(0, 16384))
      .catch(() => undefined)
      .finally(() => {
        pending -= 1
      })
  }
  for (const level of Object.keys(original) as Array<keyof typeof original>) {
    console[level] = (...args: unknown[]) => {
      original[level](...args)
      forward(level, args)
    }
  }
  /** 记录未捕获的脚本异常 */
  const onError = (event: ErrorEvent): void => forward('error', [event.error ?? event.message])
  /** 记录未处理的异步异常 */
  const onRejection = (event: PromiseRejectionEvent): void => forward('error', [event.reason])
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    disposed = true
    Object.assign(console, original)
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
