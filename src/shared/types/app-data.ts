import type { FavoriteItem } from './favorite'
import type { LiveSourceOrigin } from './live'
import type { RecentPlayItem } from './recent'
import type { VodSourceBackup, VodSourceOrigin } from './source'
import type { SubscriptionConfig } from './settings'

export interface AppDataSubscription {
  url: string
  updatedAt?: number
}

export interface AppDataVodSource {
  name: string
  url: string
  referer?: string
  enabled: boolean
  backups: VodSourceBackup[]
  origin: VodSourceOrigin
  subscriptionId?: string
  sort?: number
}

export interface AppDataLiveSource {
  name: string
  url: string
  enabled: boolean
  origin: LiveSourceOrigin
  subscriptionId?: string
  sort?: number
}

export interface AppDataBackup {
  app: 'vfan-tv'
  schemaVersion: 1
  exportedAt: number
  subscription: AppDataSubscription
  subscriptions?: SubscriptionConfig[]
  activeSubscriptionId?: string
  vod: AppDataVodSource[]
  live: AppDataLiveSource[]
  recent: RecentPlayItem[]
  favorites: FavoriteItem[]
  searchHistory: string[]
}

export interface AppDataClientPayload {
  searchHistory: string[]
}

export interface AppDataOperationCounts {
  vod: number
  live: number
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
