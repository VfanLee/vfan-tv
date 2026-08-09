export interface SourceHeaders {
  'User-Agent'?: string
  'Referer'?: string
  [key: string]: string | undefined
}

export interface VodSourceDefinition {
  name: string
  url: string
  disabled?: boolean
  headers?: SourceHeaders
  backups?: string[]
}

export interface IptvSourceDefinition {
  name: string
  url: string
  disabled?: boolean
  headers?: SourceHeaders
}

export interface SourceSubscription {
  vod: VodSourceDefinition[]
  iptv: IptvSourceDefinition[]
}

export type VodSourceImportItem = VodSourceDefinition

export interface VodSourceExportItem extends VodSourceDefinition {
  disabled: boolean
  headers: SourceHeaders
  backups: string[]
}

export type VodSourceOrigin = 'manual' | 'subscription'

export type VodSourceSubscriptionItem = VodSourceDefinition

export interface VodSourceConfig {
  id: string
  name: string
  url: string
  disabled: boolean
  headers: SourceHeaders
  backups: string[]
  sort: number
  origin: VodSourceOrigin
  remark?: string
  createdAt: number
  updatedAt: number
}

export type VodSourceInput = VodSourceDefinition

export type VodSourceSpeedResult = { status: 'success'; elapsedMs: number } | { status: 'error'; errorMessage: string }

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
  iptv: SourceSubscriptionSectionResult
  updatedAt?: number
}

export interface SourceSubscriptionSectionResult {
  created: number
  updated: number
  unchanged: number
}

export type VodSourceSubscriptionResult = SourceSubscriptionSectionResult
