import Hls from 'hls.js'
import mpegts from 'mpegts.js'
import type { MediaStreamType } from '@shared/types'

/** 频道预览缓存最多保留的条目数 */
const MAX_PREVIEWS = 120
/** 频道预览捕获任务的最大并发数 */
const MAX_CONCURRENT = 3
/** 按播放地址保存的频道预览缓存 */
const cache = new Map<string, string>()
/** 等待获取预览执行槽位的任务队列 */
const waiters: Array<() => void> = []
/** 当前正在执行的预览捕获任务数 */
let activeCount = 0

/** 清除 IPTV 预览缓存 */
export function clearIptvPreviewCache(): void {
  cache.clear()
}

/** 返回频道直播画面的 JPEG 预览图，并复用已有缓存 */
export async function getLivePreview(
  key: string,
  target: { src: string; type: MediaStreamType },
  signal: AbortSignal,
): Promise<string> {
  const cached = cache.get(key)
  if (cached) {
    cache.delete(key)
    cache.set(key, cached)
    return cached
  }
  await acquire(signal)
  try {
    const image = await captureFrame(target.src, target.type, signal)
    cache.set(key, image)
    while (cache.size > MAX_PREVIEWS) cache.delete(cache.keys().next().value as string)
    return image
  } finally {
    release()
  }
}

/** 获取一个预览执行槽位 */
async function acquire(signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  if (activeCount < MAX_CONCURRENT) {
    activeCount += 1
    return
  }
  await new Promise<void>((resolve, reject) => {
    /** 为下一个等待任务分配预览执行槽位 */
    const grant = (): void => {
      signal.removeEventListener('abort', abort)
      activeCount += 1
      resolve()
    }
    /** 取消等待中的预览任务 */
    const abort = (): void => {
      const index = waiters.indexOf(grant)
      if (index >= 0) waiters.splice(index, 1)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    waiters.push(grant)
    signal.addEventListener('abort', abort, { once: true })
  })
}

/** 释放当前预览执行槽位 */
function release(): void {
  activeCount = Math.max(0, activeCount - 1)
  waiters.shift()?.()
}

/** 从直播地址截取画面并转换为 JPEG Data URL */
async function captureFrame(src: string, type: MediaStreamType, signal: AbortSignal): Promise<string> {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.crossOrigin = 'anonymous'
  video.style.cssText = 'position:fixed;width:2px;height:2px;left:-100px;top:-100px;opacity:0;pointer-events:none'
  document.body.append(video)
  let hls: Hls | undefined
  let mpegtsPlayer: ReturnType<typeof mpegts.createPlayer> | undefined
  try {
    if (type === 'hls' && Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: true, maxBufferLength: 4 })
      hls.loadSource(src)
      hls.attachMedia(video)
    } else if ((type === 'flv' || type === 'mpegts') && mpegts.isSupported()) {
      mpegtsPlayer = mpegts.createPlayer({ type: type === 'flv' ? 'flv' : 'mpegts', isLive: true, url: src })
      mpegtsPlayer.attachMediaElement(video)
      mpegtsPlayer.load()
    } else {
      video.src = src
    }
    await waitForFrame(video, signal)
    const width = video.videoWidth || 640
    const height = video.videoHeight || 360
    const canvas = document.createElement('canvas')
    canvas.width = Math.min(640, width)
    canvas.height = Math.round((canvas.width * height) / width)
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.72)
  } finally {
    hls?.destroy()
    if (mpegtsPlayer) {
      try {
        mpegtsPlayer.unload()
        mpegtsPlayer.detachMediaElement()
        mpegtsPlayer.destroy()
      } catch {
        // 忽略关闭预览连接时的异常。
      }
    }
    video.pause()
    video.removeAttribute('src')
    video.load()
    video.remove()
  }
}

/** 等待视频加载首个可绘制画面 */
function waitForFrame(video: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error('预览超时')), 8_000)
    /** 移除画面监听器，并完成或拒绝等待任务 */
    const finish = (error?: Error): void => {
      window.clearTimeout(timeout)
      video.removeEventListener('loadeddata', ready)
      video.removeEventListener('canplay', ready)
      video.removeEventListener('error', failed)
      signal.removeEventListener('abort', aborted)
      error ? reject(error) : resolve()
    }
    /** 处理媒体帧已就绪事件 */
    const ready = (): void => {
      if (video.videoWidth > 0) finish()
      else void video.play().catch(() => undefined)
    }
    /** 处理媒体帧加载失败事件 */
    const failed = (): void => finish(new Error('无法生成频道预览'))
    /** 处理媒体帧捕获取消事件 */
    const aborted = (): void => finish(new DOMException('Aborted', 'AbortError'))
    video.addEventListener('loadeddata', ready)
    video.addEventListener('canplay', ready)
    video.addEventListener('error', failed)
    signal.addEventListener('abort', aborted, { once: true })
    void video.play().catch(() => undefined)
  })
}
