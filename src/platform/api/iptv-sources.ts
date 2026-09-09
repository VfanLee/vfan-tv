import { invoke } from '@tauri-apps/api/core'
import { isDesktopRuntime } from '../tauri'
import type {
  IptvSourceConfig,
  IptvSourceExportResult,
  IptvSourceFileResult,
  IptvSourceImportPreview,
  IptvSourceImportResult,
  IptvSourceInput,
} from '@/types'

/** 读取直播源列表 */
export async function listIptvSources(): Promise<IptvSourceConfig[]> {
  if (isDesktopRuntime()) return invoke('list_sources', { kind: 'iptv' })
  return []
}

/** 新增直播源 */
export async function createIptvSource(input: IptvSourceInput): Promise<IptvSourceConfig> {
  if (isDesktopRuntime()) return invoke('create_source', { kind: 'iptv', input })
  throw new Error('当前运行环境不支持此操作')
}

/** 更新直播源 */
export async function updateIptvSource(id: string, input: IptvSourceInput): Promise<IptvSourceConfig> {
  if (isDesktopRuntime()) return invoke('update_source', { kind: 'iptv', id, input })
  throw new Error('当前运行环境不支持此操作')
}

/** 保存直播源排序 */
export async function reorderIptvSources(sourceIds: string[]): Promise<IptvSourceConfig[]> {
  if (isDesktopRuntime()) return invoke('reorder_sources', { kind: 'iptv', sourceIds })
  throw new Error('当前运行环境不支持此操作')
}

/** 删除直播源 */
export async function deleteIptvSource(id: string): Promise<void> {
  if (isDesktopRuntime()) return invoke('delete_sources', { kind: 'iptv', id })
  throw new Error('当前运行环境不支持此操作')
}

/** 清空直播源 */
export async function clearIptvSources(): Promise<void> {
  if (isDesktopRuntime()) return invoke('delete_sources', { kind: 'iptv', id: null })
  throw new Error('当前运行环境不支持此操作')
}

/** 校验并处理源导入数据 */
export async function previewIptvSourceImport(payload: unknown): Promise<IptvSourceImportPreview> {
  if (isDesktopRuntime()) return invoke('preview_source_import', { kind: 'iptv', payload })
  throw new Error('当前运行环境不支持此操作')
}

/** 校验并处理源导入数据 */
export async function confirmIptvSourceImport(payload: unknown): Promise<IptvSourceImportResult> {
  if (isDesktopRuntime()) return invoke('confirm_source_import', { kind: 'iptv', payload })
  throw new Error('当前运行环境不支持此操作')
}

/** 使用原生对话框处理源文件 */
export async function importIptvSourcesFromFile(): Promise<IptvSourceFileResult> {
  if (isDesktopRuntime()) return invoke('import_sources_from_file', { kind: 'iptv' })
  throw new Error('当前运行环境不支持此操作')
}

/** 使用原生对话框处理源文件 */
export async function exportIptvSourcesToFile(): Promise<IptvSourceExportResult> {
  if (isDesktopRuntime()) return invoke('export_sources_to_file', { kind: 'iptv' })
  throw new Error('当前运行环境不支持此操作')
}
