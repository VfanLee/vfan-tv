import type { FavoriteItem } from './favorite'
import type { LiveSourceOrigin } from './live'
import type { RecentPlayItem } from './recent'
import type { VodSourceOrigin } from './source'

export interface AppDataSubscription {
  url: string
  updatedAt?: number
}

export interface AppDataVodSource {
  name: string
  url: string
  referer?: string
  enabled: boolean
  origin: VodSourceOrigin
  sort?: number
}

export interface AppDataLiveSource {
  name: string
  url: string
  enabled: boolean
  origin: LiveSourceOrigin
  sort?: number
}

export interface AppDataBackup {
  app: 'VfanTV'
  schemaVersion: 1
  exportedAt: number
  subscription: AppDataSubscription
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
