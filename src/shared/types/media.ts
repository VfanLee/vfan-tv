export type MediaStreamType = 'hls' | 'flv' | 'mpegts' | 'native'
export type MediaImageSourceType = 'vod' | 'iptv' | 'douban' | 'radio'

export interface MediaPlaybackCandidate {
  id: string
  name: string
  url: string
}

export interface MediaPlaybackTargetInput {
  candidates: MediaPlaybackCandidate[]
  sourceId?: string
  diagnostics?: {
    sourceName?: string
    episodeName?: string
  }
}

export interface MediaPlaybackTarget {
  src: string
  streamType: MediaStreamType
  mediaSessionId: string
  selectedCandidateId?: string
  selectedCandidateName?: string
}

export interface MediaPlaybackSessionInfo {
  mediaSessionId: string
  originalUrl: string
  finalUrl?: string
  streamType: MediaStreamType
  network: string
  createdAt: number
}

export type MediaPlaybackEventType = 'first-frame' | 'player-error' | 'manual-route-switch' | 'auto-route-switch'

export interface MediaPlaybackEvent {
  mediaSessionId: string
  type: MediaPlaybackEventType
  elapsedMs?: number
  message?: string
  success?: boolean
}

export type MediaPlaybackTargetResult = { ok: true; target: MediaPlaybackTarget } | { ok: false; errorMessage: string }

export interface MediaStreamDetectionInput {
  url: string
  headers?: Record<string, string>
}

export interface MediaStreamDetectionResult {
  type: MediaStreamType
  statusCode?: number
  contentType?: string
  finalUrl?: string
  /** 明确收到 HTTP 错误、HTML、JSON 等不可播放响应时提供的安全错误信息。 */
  errorMessage?: string
  /**
   * 探测结果无法确认时为 `true`，此时必须同时提供 `errorMessage`，不得创建播放器或缓存为原生视频。
   */
  uncertain?: boolean
}
