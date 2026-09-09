import type { VodSearchResult } from './vod'

export type SearchSourceStatus = 'pending' | 'searching' | 'success' | 'empty' | 'error' | 'timeout' | 'cancelled'

export type SearchEvent =
  | {
      type: 'source-start'
      searchId: string
      sourceId: string
      sourceName: string
    }
  | {
      type: 'source-result'
      searchId: string
      sourceId: string
      sourceName: string
      items: VodSearchResult[]
    }
  | {
      type: 'source-error'
      searchId: string
      sourceId: string
      sourceName: string
      message: string
    }
  | {
      type: 'source-timeout'
      searchId: string
      sourceId: string
      sourceName: string
      message: string
    }
  | {
      type: 'source-cancelled'
      searchId: string
      sourceId: string
      sourceName: string
    }
  | {
      type: 'done'
      searchId: string
    }
