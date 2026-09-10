import type { VodSourceConfig } from '@/types'
import { type SourceConfig } from './source-table-types'

/** 判断目标是否为点播源 */
export function isVodSource(source: SourceConfig): source is VodSourceConfig {
  return 'backups' in source
}
