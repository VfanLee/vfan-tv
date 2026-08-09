import type { FavoriteItem } from './favorite'
import type { IptvEpgSettings, IptvSourceOrigin } from './iptv'
import type { RecentPlayItem } from './recent'
import type { SourceHeaders, VodSourceOrigin } from './source'
import type { SubscriptionConfig } from './settings'

export interface AppDataVodSource {
  name: string
  url: string
  disabled: boolean
  headers: SourceHeaders
  backups: string[]
  origin: VodSourceOrigin
  sort?: number
}

export interface AppDataIptvSource {
  name: string
  url: string
  disabled: boolean
  origin: IptvSourceOrigin
  sort?: number
  headers: SourceHeaders
}

export interface AppDataBackup {
  app: 'vfan-tv'
  schemaVersion: 3
  exportedAt: number
  subscriptions: SubscriptionConfig[]
  activeSubscriptionId?: string
  iptvEpg?: IptvEpgSettings
  vod: AppDataVodSource[]
  iptv: AppDataIptvSource[]
  recent: RecentPlayItem[]
  favorites: FavoriteItem[]
  searchHistory: string[]
}

export interface AppDataClientPayload {
  selection: AppDataSelection
  searchHistory: string[]
}

export interface AppDataSelection {
  favorites: boolean
  recent: boolean
  searchHistory: boolean
  sources: boolean
}

export interface AppDataClearSelection {
  cache: boolean
  favorites: boolean
  recent: boolean
  searchHistory: boolean
  sources: boolean
}

export interface AppDataOperationCounts {
  vod: number
  iptv: number
  recent: number
  favorites: number
  searchHistory: number
}

export interface AppDataExportResult {
  cancelled: boolean
  filePath?: string
  counts: AppDataOperationCounts
}

export interface AppDataImportResult {
  cancelled: boolean
  filePath?: string
  counts: AppDataOperationCounts
  searchHistory: string[]
}
