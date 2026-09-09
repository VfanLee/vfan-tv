import { isDesktopRuntime } from '../tauri'

/** 判断是否可调用本机 Rust 服务 */
export function isApiAvailable(): boolean {
  return isDesktopRuntime()
}
