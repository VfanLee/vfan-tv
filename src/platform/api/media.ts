import { invoke } from '@tauri-apps/api/core'
import { isDesktopRuntime } from '../tauri'
import type {
  MediaImageSourceType,
  MediaPlaybackEvent,
  MediaPlaybackSessionInfo,
  MediaPlaybackTarget,
  MediaPlaybackTargetInput,
} from '@/types'

const imageUrlRequests = new Map<string, Promise<string | undefined>>()

/** 清除窗口内的图片请求缓存 */
export function clearSourceImageUrlCache(): void {
  imageUrlRequests.clear()
}

/** 解析播放候选并创建媒体会话 */
export function getMediaPlaybackTarget(input: MediaPlaybackTargetInput): Promise<MediaPlaybackTarget> {
  if (isDesktopRuntime()) return invoke('get_media_playback_target', { input })
  throw new Error('当前运行环境不支持此操作')
}

/** 解析同会话的关联音轨地址 */
export async function getAssociatedAudioUrl(mediaSessionId: string, url: string): Promise<string> {
  if (isDesktopRuntime()) return invoke('get_associated_audio_url', { mediaSessionId, url })
  throw new Error('当前运行环境不支持此操作')
}

/** 读取媒体会话诊断信息 */
export function getMediaPlaybackSessionInfo(mediaSessionId: string): Promise<MediaPlaybackSessionInfo> {
  if (isDesktopRuntime()) return invoke('get_media_session_info', { mediaSessionId })
  throw new Error('当前运行环境不支持此操作')
}

/** 保留播放器使用的会话引用 */
export async function retainMediaPlaybackSession(mediaSessionId: string): Promise<void> {
  if (isDesktopRuntime()) return invoke('retain_media_session', { mediaSessionId })
  throw new Error('当前运行环境不支持此操作')
}

/** 释放播放器使用的会话引用 */
export async function releaseMediaPlaybackSession(mediaSessionId: string): Promise<void> {
  if (isDesktopRuntime()) return invoke('release_media_session', { mediaSessionId })
  throw new Error('当前运行环境不支持此操作')
}

/** 将播放首帧、错误与换线事件写入诊断日志 */
export async function reportMediaPlaybackEvent(event: MediaPlaybackEvent): Promise<void> {
  if (isDesktopRuntime()) return invoke('report_media_playback_event', { event })
  throw new Error('当前运行环境不支持此操作')
}

/** 读取并缓存 Rust 图片代理地址 */
export async function getSourceImageUrl(
  sourceId: string | undefined,
  url: string,
  baseUrl?: string,
  sourceType: MediaImageSourceType = 'vod',
): Promise<string | undefined> {
  const key = `${sourceType}\u0000${sourceId ?? ''}\u0000${url}\u0000${baseUrl ?? ''}`
  const cached = imageUrlRequests.get(key)
  if (cached) return cached
  const request = isDesktopRuntime()
    ? invoke<string>('get_source_image_url', { sourceType, sourceId, url, baseUrl })
    : Promise.resolve(undefined)
  imageUrlRequests.set(key, request)
  if (imageUrlRequests.size > 512) imageUrlRequests.delete(imageUrlRequests.keys().next().value ?? '')
  return request.catch((error) => {
    imageUrlRequests.delete(key)
    throw error
  })
}
