import { invoke } from '@tauri-apps/api/core'
import { isDesktopRuntime } from '../tauri'
import type { AppLogInfo } from '@/types'

/** 读取日志文件与占用信息 */
export async function getLogInfo(): Promise<AppLogInfo> {
  if (isDesktopRuntime()) return invoke('get_log_info')
  throw new Error('当前运行环境不支持此操作')
}

/** 按用户操作打开日志目录 */
export async function revealLogFile(): Promise<void> {
  if (isDesktopRuntime()) return invoke('reveal_log_file')
  throw new Error('当前运行环境不支持此操作')
}

/** 清空日志并恢复后续写入 */
export async function clearLogs(): Promise<AppLogInfo> {
  if (isDesktopRuntime()) return invoke('clear_logs')
  throw new Error('当前运行环境不支持此操作')
}
