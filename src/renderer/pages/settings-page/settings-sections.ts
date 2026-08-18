import type { LucideIcon } from 'lucide-react'
import { DatabaseBackup, Info, MonitorPlay, Palette, Rss, Video } from 'lucide-react'
import type { SettingsSectionId } from '@shared/types'

export interface SettingsPageDefinition {
  id: SettingsSectionId
  label: string
  icon: LucideIcon
}

/** 设置窗口侧边导航展示的分区 */
export const settingsSections = [
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'subscriptions', label: '订阅源', icon: Rss },
  { id: 'vod-sources', label: '点播源', icon: Video },
  { id: 'iptv', label: 'IPTV', icon: MonitorPlay },
  { id: 'data-management', label: '数据管理', icon: DatabaseBackup },
  { id: 'about', label: '关于', icon: Info },
] as const satisfies ReadonlyArray<SettingsPageDefinition>

/** 解析设置区块 */
export function resolveSettingsSection(value: unknown): SettingsSectionId | undefined {
  if (value === 'network' || value === 'iptv-sources' || value === 'iptv-network') return 'iptv'
  return typeof value === 'string' && settingsSections.some((item) => item.id === value)
    ? (value as SettingsSectionId)
    : undefined
}

export type { SettingsSectionId } from '@shared/types'
