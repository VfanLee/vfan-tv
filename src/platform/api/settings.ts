import { invoke } from '@tauri-apps/api/core'
import { isDesktopRuntime } from '../tauri'
import type {
  AppDataClearSelection,
  AppSettings,
  NetworkProxyTestInput,
  NetworkProxyTestResult,
  NetworkSettings,
  NetworkStatus,
} from '@/types'

/** 读取应用设置 */
export async function getSettings(): Promise<AppSettings | undefined> {
  if (isDesktopRuntime()) return invoke('get_settings')
  return undefined
}

/** 保存应用订阅与主题设置 */
export async function updateSettings(input: Partial<AppSettings>): Promise<AppSettings> {
  if (isDesktopRuntime()) return invoke('update_settings', { input })
  throw new Error('当前运行环境不支持此操作')
}

/** 读取当前网络路由状态 */
export async function getNetworkStatus(): Promise<NetworkStatus> {
  if (isDesktopRuntime()) return invoke('get_network_status')
  throw new Error('当前运行环境不支持此操作')
}

/** 保存代理和直播路由配置 */
export async function saveNetworkSettings(settings: NetworkSettings): Promise<NetworkSettings> {
  if (isDesktopRuntime()) return invoke('save_network_settings', { settings })
  throw new Error('当前运行环境不支持此操作')
}

/** 测试网络配置且不保存 */
export async function testNetworkSettings(input: NetworkProxyTestInput): Promise<NetworkProxyTestResult> {
  if (isDesktopRuntime()) return invoke('test_network_settings', { input })
  throw new Error('当前运行环境不支持此操作')
}

/** 重置数据库中的应用数据与设置 */
export async function restoreFactorySettings(): Promise<void> {
  if (isDesktopRuntime()) return invoke('restore_factory_settings')
  throw new Error('当前运行环境不支持此操作')
}

/** 按用户选择清理持久化数据 */
export async function clearAppData(selection: AppDataClearSelection): Promise<void> {
  if (isDesktopRuntime()) return invoke('clear_app_data', { selection })
  throw new Error('当前运行环境不支持此操作')
}

export interface DatabaseTransferResult {
  cancelled: boolean
  filePath?: string
  safetyBackupPath?: string
}

/** 导出包含全部持久化数据的独立 SQLite 快照 */
export function exportDatabase(): Promise<DatabaseTransferResult> {
  return invoke('export_database')
}

/** 校验备份并在事务中恢复全部数据 */
export function importDatabase(): Promise<DatabaseTransferResult> {
  return invoke('import_database')
}
