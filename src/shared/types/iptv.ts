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
  tvgId?: string
  tvgName?: string
  epgUrl?: string
  streams: IptvChannelStream[]
}

export interface IptvPlaylist {
  sourceId?: string
  sourceUrl: string
  fetchedAt: number
  cached?: boolean
  stale?: boolean
  sourceEpgUrls: string[]
  channels: IptvChannel[]
}

export type IptvEpgMode = 'source' | 'query' | 'xmltv'

export interface IptvEpgTestState {
  status: 'idle' | 'testing' | 'success' | 'error'
  testedAt?: number
  elapsedMs?: number
  errorMessage?: string
}

export interface IptvEpgSettings {
  mode: IptvEpgMode
  url?: string
  lastTest: IptvEpgTestState
  lastSuccessAt?: number
  lastSuccessSource?: string
}

export interface IptvEpgProgram {
  id: string
  channelId: string
  title: string
  startAt: number
  endAt: number
  description?: string
}

export interface IptvChannelPrograms {
  channelId: string
  current?: IptvEpgProgram
  next?: IptvEpgProgram
}

export interface IptvProgramsResult {
  items: IptvChannelPrograms[]
  actualSource?: string
  fallback: boolean
  errorMessage?: string
}

export interface IptvProgramScheduleResult {
  channelId: string
  date: string
  programs: IptvEpgProgram[]
  actualSource?: string
  fallback: boolean
  errorMessage?: string
}

export type IptvPlaybackTarget = MediaPlaybackTarget

export interface IptvEpgTestResult extends IptvEpgTestState {
  actualSource?: string
}
