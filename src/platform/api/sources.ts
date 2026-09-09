import { invoke } from '@tauri-apps/api/core'
import { isDesktopRuntime } from '../tauri'
import type {
  SourceSubscriptionResult,
  SubscriptionNetworkMode,
  VodSourceConfig,
  VodSourceExportResult,
  VodSourceFileResult,
  VodSourceImportPreview,
  VodSourceImportResult,
  VodSourceInput,
  VodSourceSpeedResult,
} from '@/types'

/** 读取点播源列表 */
export async function listSources(): Promise<VodSourceConfig[]> {
  if (isDesktopRuntime()) return invoke('list_sources', { kind: 'vod' })
  return []
}

/** 新增点播源 */
export async function createSource(input: VodSourceInput): Promise<VodSourceConfig> {
  if (isDesktopRuntime()) return invoke('create_source', { kind: 'vod', input })
  throw new Error('当前运行环境不支持此操作')
}

/** 更新点播源 */
export async function updateSource(id: string, input: VodSourceInput): Promise<VodSourceConfig> {
  if (isDesktopRuntime()) return invoke('update_source', { kind: 'vod', id, input })
  throw new Error('当前运行环境不支持此操作')
}

/** 切换备用地址 */
export async function switchSourceBackup(id: string, backupUrl: string): Promise<VodSourceConfig> {
  if (isDesktopRuntime()) return invoke('switch_source_backup', { id, backupUrl })
  throw new Error('当前运行环境不支持此操作')
}

/** 测量点播源接口响应速度 */
export async function testSourceSpeed(id: string): Promise<VodSourceSpeedResult> {
  if (isDesktopRuntime()) return invoke('test_source_speed', { id })
  throw new Error('当前运行环境不支持此操作')
}

/** 保存点播源排序 */
export async function reorderSources(sourceIds: string[]): Promise<VodSourceConfig[]> {
  if (isDesktopRuntime()) return invoke('reorder_sources', { kind: 'vod', sourceIds })
  throw new Error('当前运行环境不支持此操作')
}

/** 删除点播源 */
export async function deleteSource(id: string): Promise<void> {
  if (isDesktopRuntime()) return invoke('delete_sources', { kind: 'vod', id })
  throw new Error('当前运行环境不支持此操作')
}

/** 清空点播源 */
export async function clearSources(): Promise<void> {
  if (isDesktopRuntime()) return invoke('delete_sources', { kind: 'vod', id: null })
  throw new Error('当前运行环境不支持此操作')
}

/** 校验并处理源导入数据 */
export async function previewSourceImport(payload: unknown): Promise<VodSourceImportPreview> {
  if (isDesktopRuntime()) return invoke('preview_source_import', { kind: 'vod', payload })
  throw new Error('当前运行环境不支持此操作')
}

/** 校验并处理源导入数据 */
export async function confirmSourceImport(payload: unknown): Promise<VodSourceImportResult> {
  if (isDesktopRuntime()) return invoke('confirm_source_import', { kind: 'vod', payload })
  throw new Error('当前运行环境不支持此操作')
}

/** 使用原生对话框处理源文件 */
export async function importSourcesFromFile(): Promise<VodSourceFileResult> {
  if (isDesktopRuntime()) return invoke('import_sources_from_file', { kind: 'vod' })
  throw new Error('当前运行环境不支持此操作')
}

/** 使用原生对话框处理源文件 */
export async function exportSourcesToFile(): Promise<VodSourceExportResult> {
  if (isDesktopRuntime()) return invoke('export_sources_to_file', { kind: 'vod' })
  throw new Error('当前运行环境不支持此操作')
}

/** 下载订阅并原子同步点播与直播源 */
export async function syncSourceSubscription(
  subscriptionId: string,
  mode: SubscriptionNetworkMode,
): Promise<SourceSubscriptionResult> {
  if (isDesktopRuntime()) return invoke('sync_source_subscription', { subscriptionId, mode })
  throw new Error('当前运行环境不支持此操作')
}

/** 删除订阅及其当前生效的源 */
export async function deleteSourceSubscription(subscriptionId: string): Promise<void> {
  if (isDesktopRuntime()) return invoke('delete_source_subscription', { subscriptionId })
  throw new Error('当前运行环境不支持此操作')
}
