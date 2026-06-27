export type LiveSourceOrigin = 'manual' | 'subscription'

export interface LiveSourceConfig {
  id: string
  name: string
  url: string
  enabled: boolean
  sort: number
  origin: LiveSourceOrigin
  createdAt: number
  updatedAt: number
}

export interface LiveSourceInput {
  name: string
  url: string
  enabled?: boolean
}

export interface LiveSourceImportItem {
  name: string
  url: string
  enabled?: boolean
}

export interface LiveSourceExportItem {
  name: string
  url: string
  enabled: boolean
}

export interface LiveSourceImportPreview {
  validItems: LiveSourceImportItem[]
  invalidItems: Array<{
    index: number
    reason: string
    raw: unknown
  }>
  newItems: LiveSourceImportItem[]
  overwriteItems: LiveSourceImportItem[]
  skippedItems: LiveSourceImportItem[]
}

export interface LiveSourceImportResult {
  created: LiveSourceConfig[]
  overwritten: LiveSourceConfig[]
  skipped: LiveSourceImportItem[]
  invalid: LiveSourceImportPreview['invalidItems']
}

export interface LiveSourceFileResult extends LiveSourceImportResult {
  filePath?: string
  cancelled: boolean
}

export interface LiveSourceExportResult {
  filePath?: string
  count: number
  cancelled: boolean
}

export interface LiveChannelStream {
  id: string
  name: string
  url: string
}

export interface LiveChannel {
  id: string
  title: string
  group: string
  logo?: string
  tvgName?: string
  epgUrl?: string
  streams: LiveChannelStream[]
}

export interface LivePlaylist {
  sourceUrl: string
  fetchedAt: number
  channels: LiveChannel[]
}
