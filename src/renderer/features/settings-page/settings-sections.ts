import type { LucideIcon } from 'lucide-react'
import { DatabaseBackup, Info, MonitorPlay, Network, Palette, Rss, Video } from 'lucide-react'

export const settingsSections = [
  { id: 'appearance', label: '外观', icon: Palette },
  { id: 'network', label: '网络', icon: Network },
  { id: 'subscriptions', label: '订阅源', icon: Rss },
  { id: 'vod-sources', label: '点播源', icon: Video },
  { id: 'live-sources', label: '直播源', icon: MonitorPlay },
  { id: 'data-management', label: '数据管理', icon: DatabaseBackup },
  { id: 'about', label: '关于', icon: Info },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: LucideIcon }>

export type SettingsSectionId = (typeof settingsSections)[number]['id']
