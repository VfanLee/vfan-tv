import type { IptvSourceConfig } from '@/types'
import {
  clearIptvSources,
  deleteIptvSource,
  exportIptvSourcesToFile,
  importIptvSourcesFromFile,
  listIptvSources,
  reorderIptvSources,
  updateIptvSource,
} from '@/platform/api'
import { useSourceManagement, type SourceAdapter, type SourceManagementState } from './use-source-management'

export type IptvSourcesState = SourceManagementState<IptvSourceConfig>

/** 直播源的读取、交换和状态更新接口 */
const adapter: SourceAdapter<IptvSourceConfig> = {
  label: 'IPTV 源',
  list: listIptvSources,
  clear: clearIptvSources,
  delete: deleteIptvSource,
  reorder: reorderIptvSources,
  import: importIptvSourcesFromFile,
  export: exportIptvSourcesToFile,
  /** 保留直播源配置，仅改变禁用状态 */
  setDisabled: (source, disabled) =>
    updateIptvSource(source.id, { name: source.name, url: source.url, headers: source.headers, disabled }),
}

/** 管理直播源列表、选择状态及文件交换 */
export function useIptvSources(apiAvailable: boolean): IptvSourcesState {
  return useSourceManagement(apiAvailable, adapter)
}
