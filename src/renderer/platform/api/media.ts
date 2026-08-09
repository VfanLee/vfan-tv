import { getRuntimeApi } from './client'
import type {
  MediaImageSourceType,
  MediaPlaybackEvent,
  MediaPlaybackSessionInfo,
  MediaPlaybackTarget,
  MediaPlaybackTargetInput,
} from '@shared/types'

const imageUrlRequests = new Map<string, Promise<string | undefined>>()

export function clearSourceImageUrlCache(): void {
  imageUrlRequests.clear()
}

export function getMediaPlaybackTarget(input: MediaPlaybackTargetInput): Promise<MediaPlaybackTarget> {
  const api = getRuntimeApi()
  if (!api) return Promise.reject(new Error('当前环境不支持媒体播放解析'))
  return api.media.getPlaybackTarget(input).then((result) => {
    if (!result.ok) throw new Error(result.errorMessage)
    return result.target
  })
}

export async function getAssociatedAudioUrl(mediaSessionId: string, url: string): Promise<string> {
  return getRuntimeApi()?.media.getAssociatedAudioUrl(mediaSessionId, url) ?? url
}

export function getMediaPlaybackSessionInfo(mediaSessionId: string): Promise<MediaPlaybackSessionInfo> {
  const api = getRuntimeApi()
  if (!api) return Promise.reject(new Error('当前环境不支持媒体会话'))
  return api.media.getPlaybackSessionInfo(mediaSessionId)
}

export async function retainMediaPlaybackSession(mediaSessionId: string): Promise<void> {
  await getRuntimeApi()?.media.retainPlaybackSession(mediaSessionId)
}

export async function releaseMediaPlaybackSession(mediaSessionId: string): Promise<void> {
  await getRuntimeApi()?.media.releasePlaybackSession(mediaSessionId)
}

export async function reportMediaPlaybackEvent(event: MediaPlaybackEvent): Promise<void> {
  await getRuntimeApi()?.media.reportPlaybackEvent(event)
}

export async function getSourceImageUrl(
  sourceId: string | undefined,
  url: string,
  baseUrl?: string,
  sourceType: MediaImageSourceType = 'vod',
): Promise<string | undefined> {
  const key = `${sourceType}\u0000${sourceId ?? ''}\u0000${url}\u0000${baseUrl ?? ''}`
  const cached = imageUrlRequests.get(key)
  if (cached) return cached
  const request = getRuntimeApi()?.media.getImageUrl(sourceType, sourceId, url, baseUrl) ?? Promise.resolve(undefined)
  imageUrlRequests.set(key, request)
  if (imageUrlRequests.size > 512) imageUrlRequests.delete(imageUrlRequests.keys().next().value ?? '')
  return request.catch((error) => {
    imageUrlRequests.delete(key)
    throw error
  })
}
