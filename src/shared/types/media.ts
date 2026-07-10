export type MediaStreamType = 'hls' | 'flv' | 'mpegts' | 'native'

export interface MediaStreamDetectionInput {
  url: string
  referer?: string
}

export interface MediaStreamDetectionResult {
  type: MediaStreamType
}
