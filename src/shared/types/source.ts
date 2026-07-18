export interface VodSourceBackup {
  url: string
  referer?: string
}

export interface VodSourceImportItem {
  name: string
  url: string
  referer?: string
  enabled?: boolean
  backups?: VodSourceBackup[]
}

export interface VodSourceExportItem {
  name: string
  url: string
  referer?: string
  enabled: boolean
  backups: VodSourceBackup[]
}

export type VodSourceOrigin = 'manual' | 'subscription'

export interface VodSourceSubscriptionItem {
  name: string
  url: string
  referer?: string
  enabled?: boolean
  backups?: VodSourceBackup[]
}

export interface VodSourceConfig {
  id: string
  name: string
  url: string
  referer?: string
  enabled: boolean
  backups: VodSourceBackup[]
  sort: number
  origin: VodSourceOrigin
  remark?: string
  createdAt: number
  updatedAt: number
}

export interface VodSourceInput {
  name: string
  url: string
  referer?: string
  enabled?: boolean
  backups?: VodSourceBackup[]
}

export interface VodSourceImportPreview {
  validItems: VodSourceImportItem[]
  invalidItems: Array<{
    index: number
    reason: string
    raw: unknown
  }>
  newItems: VodSourceImportItem[]
  overwriteItems: VodSourceImportItem[]
  skippedItems: VodSourceImportItem[]
}

export interface VodSourceImportResult {
  created: VodSourceConfig[]
  overwritten: VodSourceConfig[]
  skipped: VodSourceImportItem[]
  invalid: VodSourceImportPreview['invalidItems']
}

export interface VodSourceFileResult extends VodSourceImportResult {
  filePath?: string
  cancelled: boolean
}

export interface VodSourceExportResult {
  filePath?: string
  count: number
  cancelled: boolean
}

export interface SourceSubscriptionResult {
  vod: SourceSubscriptionSectionResult
  live: SourceSubscriptionSectionResult
  updatedAt?: number
}

export interface SourceSubscriptionSectionResult {
  created: number
  updated: number
  unchanged: number
}

export type VodSourceSubscriptionResult = SourceSubscriptionSectionResult
