export type MediaStreamType = 'hls' | 'flv' | 'mpegts' | 'native'

export interface MediaStreamDetectionInput {
  url: string
  referer?: string
  userAgent?: string
}

export interface MediaStreamDetectionResult {
  type: MediaStreamType
  /**
   * 探测因超时/网络错误而失败、被动降级为 `native` 时为 `true`。
   * 调用方应避免将该结果永久缓存，以便下次仍有机会重新探测出真实类型。
   */
  uncertain?: boolean
}
