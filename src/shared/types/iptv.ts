import type { IptvSourceDefinition, SourceHeaders } from './source'
import type { MediaPlaybackTarget } from './media'

export type IptvSourceOrigin = 'manual' | 'subscription'

export interface IptvSourceConfig {
  id: string
  name: string
  url: string
  disabled: boolean
  headers: SourceHeaders
  sort: number
  origin: IptvSourceOrigin
  createdAt: number
  updatedAt: number
}

export type IptvSourceInput = IptvSourceDefinition

export type IptvSourceImportItem = IptvSourceDefinition

export interface IptvSourceExportItem {
  name: string
  url: string
  disabled: boolean
  headers: SourceHeaders
}

export interface IptvSourceImportPreview {
  validItems: IptvSourceImportItem[]
  invalidItems: Array<{
    index: number
    reason: string
    raw: unknown
  }>
  newItems: IptvSourceImportItem[]
  overwriteItems: IptvSourceImportItem[]
  skippedItems: IptvSourceImportItem[]
}

export interface IptvSourceImportResult {
  created: IptvSourceConfig[]
  overwritten: IptvSourceConfig[]
  skipped: IptvSourceImportItem[]
  invalid: IptvSourceImportPreview['invalidItems']
}

export interface IptvSourceFileResult extends IptvSourceImportResult {
  filePath?: string
  cancelled: boolean
}

export interface IptvSourceExportResult {
  filePath?: string
  count: number
  cancelled: boolean
}

export interface IptvChannelStream {
  id: string
  name: string
  url: string
  requestHeaders?: IptvStreamRequestHeaders
  /** 明显点播文件（如 .mp4/.mkv/.flv/.webm）按假直播处理 */
  isLive: boolean
}

export interface IptvStreamRequestHeaders {
  headers: Record<string, string>
}

export interface IptvChannel {
  id: string
  title: string
  group: string
  logo?: string
  streams: IptvChannelStream[]
}

export interface IptvPlaylist {
  sourceId?: string
  sourceUrl: string
  fetchedAt: number
  cached?: boolean
  stale?: boolean
  channels: IptvChannel[]
}

export type IptvPlaybackTarget = MediaPlaybackTarget
